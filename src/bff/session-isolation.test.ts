import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { handleKonciergeProxy, type BffProxyConfig } from "./proxy";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";

/**
 * Integration test: two different authenticated users get isolated
 * Koncierge conversation histories.
 *
 * Spins up a mock Koncierge backend that:
 *  - Records messages per X-Session-Token
 *  - Returns the message history for that token in each response
 *
 * Then sends messages from two different users and verifies each
 * user only sees their own messages.
 */

const TEST_SECRET = "isolation-test-secret";

// In-memory "conversation store" in the mock backend
const conversations = new Map<string, string[]>();

let mockServer: ReturnType<typeof Bun.serve>;
let MOCK_URL: string;

beforeAll(() => {
  conversations.clear();

  mockServer = Bun.serve({
    port: 0, // OS-assigned port avoids parallel test collisions
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (apiKey !== TEST_SECRET) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionToken = req.headers.get("X-Session-Token");
        if (!sessionToken) {
          return Response.json({ error: "Missing session token" }, { status: 401 });
        }

        const body = await req.json();
        const message = body.message as string;

        // Store the message for this session token
        if (!conversations.has(sessionToken)) {
          conversations.set(sessionToken, []);
        }
        conversations.get(sessionToken)!.push(message);

        // Return SSE with the full history for this token
        const history = conversations.get(sessionToken)!;
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          start(controller) {
            const historyStr = history.join(", ");
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: `History: [${historyStr}]` })}\n\n`),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(readable, {
          status: 200,
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        });
      }

      return Response.json({ error: "Not Found" }, { status: 404 });
    },
  });

  MOCK_URL = `http://localhost:${mockServer.port}`;
});

afterAll(() => {
  mockServer.stop();
  conversations.clear();
});

function getConfig(): BffProxyConfig {
  return { konciergeUrl: MOCK_URL, konciergeSecret: TEST_SECRET };
}

function makeRequest(message: string): Request {
  return new Request(`${MOCK_URL}/api/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

// ── AC 0: Two different users each receive independent conversation histories

describe("Session isolation — two users get independent histories", () => {
  it("user A and user B see only their own messages", async () => {
    // Derive tokens for two different session-auth users
    const aliceToken = extractKonciergeToken(
      { authMode: "session", userId: "alice-uuid-001", orgId: "org-1" },
      TEST_SECRET,
    )!;
    const bobToken = extractKonciergeToken(
      { authMode: "session", userId: "bob-uuid-002", orgId: "org-1" },
      TEST_SECRET,
    )!;

    expect(aliceToken).not.toBe(bobToken);

    // Alice sends "Hello from Alice"
    const aliceRes1 = await handleKonciergeProxy(makeRequest("Hello from Alice"), getConfig(), aliceToken);
    expect(aliceRes1.status).toBe(200);
    const aliceText1 = await aliceRes1.text();
    expect(aliceText1).toContain("Hello from Alice");
    expect(aliceText1).not.toContain("Bob");

    // Bob sends "Hello from Bob"
    const bobRes1 = await handleKonciergeProxy(makeRequest("Hello from Bob"), getConfig(), bobToken);
    expect(bobRes1.status).toBe(200);
    const bobText1 = await bobRes1.text();
    expect(bobText1).toContain("Hello from Bob");
    expect(bobText1).not.toContain("Alice");

    // Alice sends a second message — should see both her messages, none of Bob's
    const aliceRes2 = await handleKonciergeProxy(makeRequest("Alice again"), getConfig(), aliceToken);
    expect(aliceRes2.status).toBe(200);
    const aliceText2 = await aliceRes2.text();
    expect(aliceText2).toContain("Hello from Alice");
    expect(aliceText2).toContain("Alice again");
    expect(aliceText2).not.toContain("Bob");

    // Bob sends a second message — should see both his messages, none of Alice's
    const bobRes2 = await handleKonciergeProxy(makeRequest("Bob again"), getConfig(), bobToken);
    expect(bobRes2.status).toBe(200);
    const bobText2 = await bobRes2.text();
    expect(bobText2).toContain("Hello from Bob");
    expect(bobText2).toContain("Bob again");
    expect(bobText2).not.toContain("Alice");
  });
});

// ── AC 1: Token is stable per-user identifier (HMAC-derived)

describe("Session isolation — token stability", () => {
  it("same user always gets the same token (survives page reload)", () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-persistent-id",
      orgId: "org-1",
    };
    const token1 = extractKonciergeToken(identity, TEST_SECRET);
    const token2 = extractKonciergeToken(identity, TEST_SECRET);
    expect(token1).toBe(token2);
  });

  it("apikey auth derives token from orgId:keyType", () => {
    const identity: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-42",
      keyType: "live",
    };
    const token1 = extractKonciergeToken(identity, TEST_SECRET);
    const token2 = extractKonciergeToken(identity, TEST_SECRET);
    expect(token1).toBe(token2);
    expect(token1).toHaveLength(64);
  });
});

// ── AC 2: Page reload preserves session token

describe("Session isolation — consistency across reloads", () => {
  it("reloading the page preserves the same Koncierge token for a session-auth user", () => {
    // Simulate two "page loads" with the same auth identity
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-reload-test",
      orgId: "org-1",
      sessionToken: "platform-session-tok-abc",
    };

    // First "page load" — derives a token
    const tokenOnLoad1 = extractKonciergeToken(identity, TEST_SECRET);

    // Second "page load" — same identity, same secret → same token
    const tokenOnLoad2 = extractKonciergeToken(identity, TEST_SECRET);

    expect(tokenOnLoad1).toBe(tokenOnLoad2);
    expect(tokenOnLoad1).toHaveLength(64);
  });

  it("reloading the page preserves the same Koncierge token for an apikey-auth user", () => {
    const identity: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-99",
      keyType: "admin",
    };

    const tokenOnLoad1 = extractKonciergeToken(identity, TEST_SECRET);
    const tokenOnLoad2 = extractKonciergeToken(identity, TEST_SECRET);

    expect(tokenOnLoad1).toBe(tokenOnLoad2);
  });
});
