import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createKonciergeHandler, type KonciergeRouteOptions } from "./api.koncierge.message";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";
import type { BffProxyConfig } from "./proxy";

/**
 * Tests for the route handler that wires requireAuth → extractKonciergeToken → handleKonciergeProxy.
 *
 * Uses a mock Koncierge backend that echoes back the X-Session-Token it receives,
 * so we can verify the handler correctly derives tokens from the auth identity.
 */

const TEST_SECRET = "route-handler-test-secret";
const MOCK_PORT = 39_401;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  mockServer = Bun.serve({
    port: MOCK_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (apiKey !== TEST_SECRET) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sessionToken = req.headers.get("X-Session-Token") ?? "MISSING";

        // Echo back the session token so the test can verify it
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
});

afterAll(() => {
  mockServer.stop();
});

const proxyConfig: BffProxyConfig = {
  konciergeUrl: MOCK_URL,
  konciergeSecret: TEST_SECRET,
};

function makeRequest(message: string): Request {
  return new Request(`${MOCK_URL}/api/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

// ── AC 2: X-Session-Token is derived from auth identity, not random UUID ──

describe("Route handler — derives session token from auth identity", () => {
  it("passes HMAC-derived token from session auth userId to upstream", async () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-alice-uuid",
      orgId: "org-1",
    };

    const handler = createKonciergeHandler({
      requireAuth: () => identity,
      secret: TEST_SECRET,
      proxyConfig,
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(identity, TEST_SECRET)!;
    expect(body).toContain(`token:${expectedToken}`);
  });

  it("passes HMAC-derived token from apikey auth to upstream", async () => {
    const identity: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-42",
      keyType: "live",
    };

    const handler = createKonciergeHandler({
      requireAuth: () => identity,
      secret: TEST_SECRET,
      proxyConfig,
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(200);

    const body = await res.text();
    const expectedToken = extractKonciergeToken(identity, TEST_SECRET)!;
    expect(body).toContain(`token:${expectedToken}`);
  });
});

// ── AC 0: Same user across navigations retains conversation ──

describe("Route handler — deterministic token per user", () => {
  it("same userId always produces the same token (survives page navigation)", async () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-persistent",
      orgId: "org-1",
    };

    const handler = createKonciergeHandler({
      requireAuth: () => identity,
      secret: TEST_SECRET,
      proxyConfig,
    });

    // Simulate two requests (two page navigations)
    const res1 = await handler(makeRequest("first message"));
    const res2 = await handler(makeRequest("second message"));

    const text1 = await res1.text();
    const text2 = await res2.text();

    // Both should contain the same token
    const expectedToken = extractKonciergeToken(identity, TEST_SECRET)!;
    expect(text1).toContain(`token:${expectedToken}`);
    expect(text2).toContain(`token:${expectedToken}`);
  });
});

// ── AC 3: Different users get distinct tokens ──

describe("Route handler — different users get different tokens", () => {
  it("alice and bob receive different session tokens", async () => {
    const aliceIdentity: AuthIdentity = {
      authMode: "session",
      userId: "alice-uuid",
      orgId: "org-1",
    };
    const bobIdentity: AuthIdentity = {
      authMode: "session",
      userId: "bob-uuid",
      orgId: "org-1",
    };

    const aliceHandler = createKonciergeHandler({
      requireAuth: () => aliceIdentity,
      secret: TEST_SECRET,
      proxyConfig,
    });
    const bobHandler = createKonciergeHandler({
      requireAuth: () => bobIdentity,
      secret: TEST_SECRET,
      proxyConfig,
    });

    const aliceRes = await aliceHandler(makeRequest("hi from alice"));
    const bobRes = await bobHandler(makeRequest("hi from bob"));

    const aliceText = await aliceRes.text();
    const bobText = await bobRes.text();

    const aliceToken = extractKonciergeToken(aliceIdentity, TEST_SECRET)!;
    const bobToken = extractKonciergeToken(bobIdentity, TEST_SECRET)!;

    expect(aliceToken).not.toBe(bobToken);
    expect(aliceText).toContain(`token:${aliceToken}`);
    expect(bobText).toContain(`token:${bobToken}`);
  });
});

// ── AC 1: New login starts a new conversation ──

describe("Route handler — new login produces new token", () => {
  it("different session tokens are generated for different user identities", () => {
    // A "new login" means a different userId in the auth identity
    const loginA: AuthIdentity = { authMode: "session", userId: "user-v1", orgId: "org-1" };
    const loginB: AuthIdentity = { authMode: "session", userId: "user-v2", orgId: "org-1" };

    const tokenA = extractKonciergeToken(loginA, TEST_SECRET);
    const tokenB = extractKonciergeToken(loginB, TEST_SECRET);

    expect(tokenA).not.toBe(tokenB);
  });
});

// ── Edge case: requireAuth throws → 401 ──

describe("Route handler — auth failure", () => {
  it("returns 401 when requireAuth throws", async () => {
    const handler = createKonciergeHandler({
      requireAuth: () => { throw new Error("Not authenticated"); },
      secret: TEST_SECRET,
      proxyConfig,
    });

    const res = await handler(makeRequest("hello"));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toContain("authentication required");
  });

  it("returns 401 when identity cannot produce a token (no userId, no sessionToken)", async () => {
    const handler = createKonciergeHandler({
      requireAuth: () => ({ authMode: "session", userId: null, sessionToken: null }),
      secret: TEST_SECRET,
      proxyConfig,
    });

    const res = await handler(makeRequest("hello"));
    // extractKonciergeToken returns null → handleKonciergeProxy returns 401
    expect(res.status).toBe(401);
  });
});
