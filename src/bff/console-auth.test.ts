import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  createConsoleRequireAuth,
  type ConsoleSessionData,
  type ConsoleRequireAuthOptions,
} from "./console-auth";
import { createKonciergeHandler } from "./api.koncierge.message";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";
import type { BffProxyConfig } from "./proxy";

/**
 * Integration tests for the console → Koncierge auth bridge.
 *
 * Uses a mock Koncierge backend that echoes back the X-Session-Token
 * and X-Koncierge-Key it receives, so we can verify:
 *   - AC 0: Unauthenticated → 401
 *   - AC 1: Token is HMAC-SHA256(session:{userId}, secret)
 *   - AC 2: Two users → different tokens
 *   - AC 3: Same user across reloads → same token
 *   - AC 4: No PII forwarded — only the HMAC token
 */

const TEST_SECRET = "console-auth-test-secret";

let mockServer: ReturnType<typeof Bun.serve>;
let MOCK_URL: string;

// Track what headers the mock backend received (for AC 4: no PII check)
let lastReceivedHeaders: Record<string, string> = {};

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0, // OS-assigned
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (apiKey !== TEST_SECRET) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionToken = req.headers.get("X-Session-Token") ?? "MISSING";

        // Record all received headers for PII verification
        lastReceivedHeaders = {};
        for (const [key, value] of req.headers.entries()) {
          lastReceivedHeaders[key.toLowerCase()] = value;
        }

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: `token:${sessionToken}` })}\n\n`),
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
});

function getProxyConfig(): BffProxyConfig {
  return { konciergeUrl: MOCK_URL, konciergeSecret: TEST_SECRET };
}

function makeRequest(message: string): Request {
  return new Request(`${MOCK_URL}/api/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

// ── AC 0: Unauthenticated requests return 401 ────────────────────

describe("Console auth — unauthenticated requests return 401", () => {
  it("returns 401 when getSessionData returns null (no cookie)", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => null,
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toContain("authentication required");
  });

  it("returns 401 when session has no authMode", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({} as ConsoleSessionData),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when session auth has no userId and no sessionToken", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: null,
        sessionToken: null,
      }),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(401);
  });
});

// ── AC 1: Token is HMAC-SHA256(session:{userId}, KONCIERGE_SECRET) ───

describe("Console auth — derives HMAC token from real org_member.id", () => {
  it("derives token from userId when present in cookie", async () => {
    const orgMemberId = "om-alice-uuid-123";

    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: orgMemberId,
        sessionToken: "kses_alice_token",
        orgId: "org-1",
        email: "alice@example.com",
      }),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId: orgMemberId, orgId: "org-1" },
      TEST_SECRET,
    )!;

    expect(body).toContain(`token:${expectedToken}`);
    expect(expectedToken).toHaveLength(64);
  });

  it("resolves userId via resolveUserId when not in cookie", async () => {
    const resolvedUserId = "om-resolved-uuid-456";

    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: null,
        sessionToken: "kses_needs_resolve",
        orgId: "org-1",
      }),
      resolveUserId: async (_sessionToken: string) => resolvedUserId,
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId: resolvedUserId, orgId: "org-1" },
      TEST_SECRET,
    )!;

    expect(body).toContain(`token:${expectedToken}`);
  });

  it("falls back to sessionToken when resolveUserId is not provided", async () => {
    const sessionToken = "kses_fallback_token";

    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: null,
        sessionToken,
        orgId: "org-1",
      }),
      // No resolveUserId — falls back to sessionToken
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    // extractKonciergeToken will use session-tok:{sessionToken} fallback
    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId: null, sessionToken, orgId: "org-1" },
      TEST_SECRET,
    )!;

    expect(body).toContain(`token:${expectedToken}`);
  });

  it("derives token from orgId:keyType for apikey auth", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "apikey" as const,
        orgId: "org-42",
        keyType: "live",
        apiKey: "pk_live_abc123",
      }),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "apikey", orgId: "org-42", keyType: "live" },
      TEST_SECRET,
    )!;

    expect(body).toContain(`token:${expectedToken}`);
  });
});

// ── AC 2: Two different users → different tokens ─────────────────

describe("Console auth — two users produce different tokens (isolated histories)", () => {
  it("alice and bob get different HMAC tokens", async () => {
    const aliceAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: "om-alice-uuid",
        sessionToken: "kses_alice",
        orgId: "org-1",
        email: "alice@example.com",
      }),
    });

    const bobAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: "om-bob-uuid",
        sessionToken: "kses_bob",
        orgId: "org-1",
        email: "bob@example.com",
      }),
    });

    const aliceHandler = createKonciergeHandler({
      requireAuth: aliceAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const bobHandler = createKonciergeHandler({
      requireAuth: bobAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const aliceRes = await aliceHandler(makeRequest("hi from alice"));
    const bobRes = await bobHandler(makeRequest("hi from bob"));

    expect(aliceRes.status).toBe(200);
    expect(bobRes.status).toBe(200);

    const aliceBody = await aliceRes.text();
    const bobBody = await bobRes.text();

    // Extract the tokens from the echoed responses
    const aliceTokenMatch = aliceBody.match(/token:([0-9a-f]{64})/);
    const bobTokenMatch = bobBody.match(/token:([0-9a-f]{64})/);

    expect(aliceTokenMatch).not.toBeNull();
    expect(bobTokenMatch).not.toBeNull();

    // Different users MUST get different tokens
    expect(aliceTokenMatch![1]).not.toBe(bobTokenMatch![1]);
  });

  it("session user and apikey user in same org get different tokens", async () => {
    const sessionAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: "om-user-uuid",
        sessionToken: "kses_user",
        orgId: "org-1",
      }),
    });

    const apikeyAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "apikey" as const,
        orgId: "org-1",
        keyType: "live",
      }),
    });

    const sessionHandler = createKonciergeHandler({
      requireAuth: sessionAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const apikeyHandler = createKonciergeHandler({
      requireAuth: apikeyAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const sessionRes = await sessionHandler(makeRequest("hi"));
    const apikeyRes = await apikeyHandler(makeRequest("hi"));

    const sessionBody = await sessionRes.text();
    const apikeyBody = await apikeyRes.text();

    const sessionToken = sessionBody.match(/token:([0-9a-f]{64})/)?.[1];
    const apikeyToken = apikeyBody.match(/token:([0-9a-f]{64})/)?.[1];

    expect(sessionToken).not.toBe(apikeyToken);
  });
});

// ── AC 3: Same user's token is stable across page reloads ────────

describe("Console auth — same user token stable across reloads", () => {
  it("same userId produces identical token on every request (page reload)", async () => {
    const sessionData: ConsoleSessionData = {
      authMode: "session",
      userId: "om-persistent-uuid",
      sessionToken: "kses_persistent",
      orgId: "org-1",
      email: "persistent@example.com",
    };

    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => sessionData,
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    // Simulate 3 page loads / requests
    const res1 = await handler(makeRequest("first load"));
    const res2 = await handler(makeRequest("second load"));
    const res3 = await handler(makeRequest("third load"));

    const body1 = await res1.text();
    const body2 = await res2.text();
    const body3 = await res3.text();

    const token1 = body1.match(/token:([0-9a-f]{64})/)?.[1];
    const token2 = body2.match(/token:([0-9a-f]{64})/)?.[1];
    const token3 = body3.match(/token:([0-9a-f]{64})/)?.[1];

    expect(token1).toBeDefined();
    expect(token1).toBe(token2);
    expect(token2).toBe(token3);
  });

  it("token survives browser session (deterministic from userId, not random)", () => {
    // Pure unit test — no server needed
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "om-deterministic-uuid",
      orgId: "org-1",
    };

    // Generate token 100 times — must always be the same
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(extractKonciergeToken(identity, TEST_SECRET)!);
    }

    expect(tokens.size).toBe(1); // All identical
    expect([...tokens][0]).toHaveLength(64);
  });
});

// ── AC 4: No PII forwarded to Koncierge server ──────────────────

describe("Console auth — no PII forwarded to Koncierge backend", () => {
  it("only X-Session-Token (HMAC) and X-Koncierge-Key are sent upstream", async () => {
    lastReceivedHeaders = {};

    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: "om-pii-test-uuid",
        sessionToken: "kses_pii_test_token_secret",
        orgId: "org-pii-test",
        email: "sensitive@example.com",
        name: "Sensitive User",
        role: "admin",
      }),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("check pii"));
    expect(res.status).toBe(200);
    await res.text(); // consume body

    // Verify: the HMAC token IS sent
    expect(lastReceivedHeaders["x-session-token"]).toBeDefined();
    expect(lastReceivedHeaders["x-session-token"]).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(lastReceivedHeaders["x-session-token"])).toBe(true);

    // Verify: the API key IS sent
    expect(lastReceivedHeaders["x-koncierge-key"]).toBe(TEST_SECRET);

    // Verify: NO PII is forwarded
    const allHeaderValues = Object.values(lastReceivedHeaders).join(" ");
    expect(allHeaderValues).not.toContain("sensitive@example.com");
    expect(allHeaderValues).not.toContain("Sensitive User");
    expect(allHeaderValues).not.toContain("om-pii-test-uuid");
    expect(allHeaderValues).not.toContain("kses_pii_test_token_secret");
    expect(allHeaderValues).not.toContain("org-pii-test");

    // The session cookie value itself must not appear
    const headerKeys = Object.keys(lastReceivedHeaders);
    for (const key of headerKeys) {
      expect(key.toLowerCase()).not.toBe("cookie");
    }
  });
});

// ── Edge cases ───────────────────────────────────────────────────

describe("Console auth — edge cases", () => {
  it("apikey auth without orgId throws (→ 401)", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "apikey" as const,
        orgId: null,
      }),
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(401);
  });

  it("resolveUserId failure falls back gracefully to sessionToken", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: () => ({
        authMode: "session" as const,
        userId: null,
        sessionToken: "kses_resolve_fail",
        orgId: "org-1",
      }),
      resolveUserId: async () => null, // API call failed
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    // Falls back to session-tok: prefix
    const body = await res.text();
    const expectedToken = extractKonciergeToken(
      { authMode: "session", userId: null, sessionToken: "kses_resolve_fail" },
      TEST_SECRET,
    )!;
    expect(body).toContain(`token:${expectedToken}`);
  });

  it("async getSessionData is supported", async () => {
    const requireAuth = createConsoleRequireAuth({
      getSessionData: async () => {
        // Simulate async cookie parsing
        await new Promise((r) => setTimeout(r, 1));
        return {
          authMode: "session" as const,
          userId: "om-async-uuid",
          sessionToken: "kses_async",
          orgId: "org-1",
        };
      },
    });

    const handler = createKonciergeHandler({
      requireAuth,
      secret: TEST_SECRET,
      proxyConfig: getProxyConfig(),
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);
  });
});
