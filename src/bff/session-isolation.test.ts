import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { handleKonciergeProxy, type BffProxyConfig } from "./proxy";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";
import { getSession } from "../session";

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

// ── Adversarial token-tampering — forged tokens cannot access real sessions

/**
 * Flip the last hex character of a token to produce a forged variant.
 * e.g. "abc0" → "abc1", "abcf" → "abce"
 */
function forgeToken(realToken: string): string {
  const lastChar = realToken[realToken.length - 1];
  const flipped = lastChar === "0" ? "1" : "0";
  return realToken.slice(0, -1) + flipped;
}

describe("Session isolation — adversarial token", () => {
  it("forged token (off-by-one from Alice) does NOT see Alice's messages via BFF proxy", async () => {
    // Task 1: Derive Alice's real token
    const aliceToken = extractKonciergeToken(
      { authMode: "session", userId: "alice-adversarial-001", orgId: "org-adv" },
      TEST_SECRET,
    )!;
    expect(aliceToken).toHaveLength(64);

    // Construct a forged token by flipping the last hex character
    const forgedToken = forgeToken(aliceToken);
    expect(forgedToken).not.toBe(aliceToken);
    expect(forgedToken).toHaveLength(64);

    // Task 2: Alice sends a message — establishes her history in the mock backend
    const aliceRes = await handleKonciergeProxy(
      makeRequest("Hello from Alice — secret onboarding data"),
      getConfig(),
      aliceToken,
    );
    expect(aliceRes.status).toBe(200);
    const aliceText = await aliceRes.text();
    expect(aliceText).toContain("Hello from Alice");

    // Task 3: Attacker probes with the forged token
    const forgedRes = await handleKonciergeProxy(
      makeRequest("probe from attacker"),
      getConfig(),
      forgedToken,
    );
    expect(forgedRes.status).toBe(200);
    const forgedText = await forgedRes.text();

    // Task 4: The forged-token response must NOT contain Alice's messages
    expect(forgedText).not.toContain("Hello from Alice");
    expect(forgedText).not.toContain("secret onboarding data");
    // The forged response only has the attacker's own probe message
    expect(forgedText).toContain("probe from attacker");
  });

  it("truncated token gets a fresh session, not Alice's", async () => {
    const aliceToken = extractKonciergeToken(
      { authMode: "session", userId: "alice-truncate-001", orgId: "org-trunc" },
      TEST_SECRET,
    )!;

    // Alice establishes history
    const aliceRes = await handleKonciergeProxy(
      makeRequest("Alice truncation test message"),
      getConfig(),
      aliceToken,
    );
    expect(aliceRes.status).toBe(200);

    // Attacker uses a truncated version of Alice's token (first 32 chars)
    const truncatedToken = aliceToken.slice(0, 32);
    expect(truncatedToken).not.toBe(aliceToken);

    const truncRes = await handleKonciergeProxy(
      makeRequest("truncated probe"),
      getConfig(),
      truncatedToken,
    );
    expect(truncRes.status).toBe(200);
    const truncText = await truncRes.text();

    // Must NOT contain Alice's message
    expect(truncText).not.toContain("Alice truncation test message");
    expect(truncText).toContain("truncated probe");
  });

  it("server-level getSession(forgedToken) returns empty history, not Alice's", () => {
    // Use the server-level session store directly (not the mock HTTP backend)
    const aliceServerToken = "adversarial-alice-server-token-real";
    const forgedServerToken = forgeToken(aliceServerToken);

    // Alice establishes a session with history
    const aliceSession = getSession(aliceServerToken);
    aliceSession.history.push({ role: "user", content: "Alice server-side secret" });
    aliceSession.history.push({ role: "assistant", content: "Welcome Alice!" });
    expect(aliceSession.history.length).toBe(2);

    // Attacker tries the forged token — must get a FRESH session
    const forgedSession = getSession(forgedServerToken);
    expect(forgedSession).not.toBe(aliceSession);
    expect(forgedSession.history.length).toBe(0);
    expect(forgedSession.history).not.toBe(aliceSession.history);

    // Alice's session is unaffected
    expect(aliceSession.history.length).toBe(2);
    expect(JSON.stringify(aliceSession.history)).toContain("Alice server-side secret");
  });
});
