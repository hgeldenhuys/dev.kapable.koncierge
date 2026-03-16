/**
 * End-to-end integration test: wire real console auth into Koncierge route.
 *
 * Demonstrates the full production wiring:
 *   createConsoleRequireAuth(options) → createKonciergeHandler(config) → Response
 *
 * Verifies all story ACs for KN-THM-023-02:
 *   AC 0: POST without session cookie → 401
 *   AC 1: Authenticated user gets HMAC-derived X-Session-Token (not hardcoded)
 *   AC 2: Two different users → separate conversation histories
 *   AC 3: KONCIERGE_SECRET mismatch → 403 from backend, surfaced as error
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createConsoleRequireAuth, type ConsoleSessionData } from "./console-auth";
import { createKonciergeHandler, type KonciergeRouteOptions } from "./api.koncierge.message";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";
import type { BffProxyConfig } from "./proxy";

const BACKEND_SECRET = "wire-auth-e2e-test-secret";

// ── Mock Koncierge backend ─────────────────────────────────────────

/** In-memory conversation store keyed by X-Session-Token */
const conversations = new Map<string, string[]>();

let mockServer: ReturnType<typeof Bun.serve>;
let MOCK_URL: string;

beforeAll(() => {
  conversations.clear();

  mockServer = Bun.serve({
    port: 0, // OS-assigned
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        // Validate shared secret
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (apiKey !== BACKEND_SECRET) {
          // AC 3: mismatch → 403
          return Response.json(
            { error: "Forbidden — invalid Koncierge secret" },
            { status: 403 },
          );
        }

        const sessionToken = req.headers.get("X-Session-Token");
        if (!sessionToken) {
          return Response.json({ error: "Missing session token" }, { status: 401 });
        }

        const body = await req.json();
        const message = body.message as string;

        // Store message per session token (for isolation testing)
        if (!conversations.has(sessionToken)) {
          conversations.set(sessionToken, []);
        }
        conversations.get(sessionToken)!.push(message);

        const history = conversations.get(sessionToken)!;
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          start(controller) {
            const historyStr = history.join(", ");
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: `History: [${historyStr}]` })}\n\n`),
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ sessionToken })}\n\n`),
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

// ── Helpers ─────────────────────────────────────────────────────────

function getProxyConfig(secret: string = BACKEND_SECRET): BffProxyConfig {
  return { konciergeUrl: MOCK_URL, konciergeSecret: secret };
}

function makeRequest(message: string): Request {
  return new Request(`${MOCK_URL}/api/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

/**
 * Build a full handler that uses createConsoleRequireAuth (the REAL auth)
 * wired into createKonciergeHandler — exactly as the console server would.
 */
function buildHandler(
  sessionData: ConsoleSessionData | null,
  secret: string = BACKEND_SECRET,
) {
  const requireAuth = createConsoleRequireAuth({
    getSessionData: () => sessionData,
  });

  return createKonciergeHandler({
    requireAuth,
    secret,
    proxyConfig: getProxyConfig(secret),
  });
}

// ── AC 0: POST /api/koncierge/message returns 401 without valid session ──

describe("Wire real auth — AC 0: unauthenticated → 401", () => {
  it("returns 401 when no session cookie exists (getSessionData → null)", async () => {
    const handler = buildHandler(null);
    const res = await handler(makeRequest("hello"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("authentication required");
  });

  it("returns 401 when session has no authMode (invalid cookie)", async () => {
    const handler = buildHandler({} as ConsoleSessionData);
    const res = await handler(makeRequest("hello"));

    expect(res.status).toBe(401);
  });

  it("returns 401 when session auth has neither userId nor sessionToken", async () => {
    const handler = buildHandler({
      authMode: "session",
      userId: null,
      sessionToken: null,
    });
    const res = await handler(makeRequest("hello"));

    expect(res.status).toBe(401);
  });
});

// ── AC 1: Authenticated user gets HMAC-derived X-Session-Token ────────

describe("Wire real auth — AC 1: HMAC-derived session token", () => {
  it("derives token from userId via HMAC (not hardcoded)", async () => {
    const userId = "om-real-user-uuid-abc";
    const handler = buildHandler({
      authMode: "session",
      userId,
      sessionToken: "kses_real_session_tok",
      orgId: "org-production",
      email: "user@kapable.dev",
    });

    const res = await handler(makeRequest("hello from real auth"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId, orgId: "org-production" },
      BACKEND_SECRET,
    )!;

    // The mock echoes the session token — verify it's the HMAC-derived one
    expect(body).toContain(expectedToken);
    expect(expectedToken).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(expectedToken)).toBe(true);
  });

  it("token is deterministic — same user on different requests gets same token", async () => {
    const userId = "om-deterministic-uuid";
    const handler = buildHandler({
      authMode: "session",
      userId,
      sessionToken: "kses_det",
      orgId: "org-1",
    });

    const res1 = await handler(makeRequest("first"));
    const res2 = await handler(makeRequest("second"));

    const body1 = await res1.text();
    const body2 = await res2.text();

    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId, orgId: "org-1" },
      BACKEND_SECRET,
    )!;

    expect(body1).toContain(expectedToken);
    expect(body2).toContain(expectedToken);
  });
});

// ── AC 2: Two different users get separate conversation histories ───

describe("Wire real auth — AC 2: isolated conversations per user", () => {
  it("alice and bob see only their own messages", async () => {
    const aliceHandler = buildHandler({
      authMode: "session",
      userId: "om-alice-e2e",
      sessionToken: "kses_alice_e2e",
      orgId: "org-shared",
      email: "alice@kapable.dev",
    });

    const bobHandler = buildHandler({
      authMode: "session",
      userId: "om-bob-e2e",
      sessionToken: "kses_bob_e2e",
      orgId: "org-shared",
      email: "bob@kapable.dev",
    });

    // Alice sends first
    const aliceRes1 = await aliceHandler(makeRequest("Alice says hi"));
    expect(aliceRes1.status).toBe(200);
    const aliceBody1 = await aliceRes1.text();
    expect(aliceBody1).toContain("Alice says hi");
    expect(aliceBody1).not.toContain("Bob");

    // Bob sends
    const bobRes1 = await bobHandler(makeRequest("Bob says hello"));
    expect(bobRes1.status).toBe(200);
    const bobBody1 = await bobRes1.text();
    expect(bobBody1).toContain("Bob says hello");
    expect(bobBody1).not.toContain("Alice");

    // Alice sends again — should see her history, not Bob's
    const aliceRes2 = await aliceHandler(makeRequest("Alice second msg"));
    const aliceBody2 = await aliceRes2.text();
    expect(aliceBody2).toContain("Alice says hi");
    expect(aliceBody2).toContain("Alice second msg");
    expect(aliceBody2).not.toContain("Bob");

    // Verify tokens are different
    const aliceToken = extractKonciergeToken(
      { authMode: "session", userId: "om-alice-e2e", orgId: "org-shared" },
      BACKEND_SECRET,
    )!;
    const bobToken = extractKonciergeToken(
      { authMode: "session", userId: "om-bob-e2e", orgId: "org-shared" },
      BACKEND_SECRET,
    )!;
    expect(aliceToken).not.toBe(bobToken);
  });
});

// ── AC 3: KONCIERGE_SECRET mismatch → 403 surfaced as error ─────────

describe("Wire real auth — AC 3: secret mismatch → 403", () => {
  it("returns 403 when console's KONCIERGE_SECRET differs from backend's", async () => {
    // Build handler with WRONG secret — simulates misconfigured .env
    const handler = buildHandler(
      {
        authMode: "session",
        userId: "om-mismatch-user",
        sessionToken: "kses_mismatch",
        orgId: "org-1",
      },
      "wrong-secret-that-doesnt-match-backend",
    );

    const res = await handler(makeRequest("hello with wrong secret"));
    // The mock backend validates X-Koncierge-Key and returns 403 on mismatch
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toContain("Forbidden");
  });

  it("surfaces the 403 error in the response (visible to panel)", async () => {
    const handler = buildHandler(
      {
        authMode: "session",
        userId: "om-mismatch-user-2",
        sessionToken: "kses_mismatch_2",
        orgId: "org-1",
      },
      "completely-wrong-secret",
    );

    const res = await handler(makeRequest("test"));
    expect(res.status).toBe(403);

    // Verify the error body can be parsed by the panel
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });
});

// ── Bonus: apikey auth mode works end-to-end ────────────────────────

describe("Wire real auth — apikey mode end-to-end", () => {
  it("derives token from orgId:keyType for API key sessions", async () => {
    const handler = buildHandler({
      authMode: "apikey",
      orgId: "org-api-e2e",
      keyType: "live",
    });

    const res = await handler(makeRequest("hello via apikey"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "apikey", orgId: "org-api-e2e", keyType: "live" },
      BACKEND_SECRET,
    )!;
    expect(body).toContain(expectedToken);
  });
});
