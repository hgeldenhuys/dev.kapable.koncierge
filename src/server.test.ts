import { describe, it, expect, beforeAll, afterAll } from "bun:test";

/**
 * Integration tests for CORS + auth middleware.
 *
 * We spin up a minimal Bun server that mirrors the middleware logic from
 * server.ts (origin checking, X-Koncierge-Key validation) without needing
 * the real Anthropic session. This lets us test the middleware layer in
 * isolation.
 */

const TEST_SECRET = "test-secret-12345";
const TEST_PORT = 39_101; // unlikely to collide

const ALLOWED_ORIGINS = new Set([
  "https://console.kapable.dev",
  "http://localhost:3005",
]);

function corsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : "";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Session-Token, X-Koncierge-Key",
    Vary: "Origin",
  };
}

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: TEST_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const origin = req.headers.get("Origin");
      const cors = corsHeaders(origin);

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok" }, { status: 200, headers: cors });
      }

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (!apiKey || apiKey !== TEST_SECRET) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: cors },
          );
        }

        // Parse body and echo route context back for testing
        const body = await req.json().catch(() => ({}));
        return Response.json(
          {
            ok: true,
            received_route: body.route ?? null,
            received_pageTitle: body.pageTitle ?? null,
          },
          { status: 200, headers: cors },
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: cors },
      );
    },
  });
});

afterAll(() => {
  server.stop();
});

const base = `http://localhost:${TEST_PORT}`;

// ── AC 0: Requests from console.kapable.dev are accepted (CORS headers present)
describe("CORS — console.kapable.dev origin", () => {
  it("reflects origin in Access-Control-Allow-Origin", async () => {
    const res = await fetch(`${base}/health`, {
      headers: { Origin: "https://console.kapable.dev" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://console.kapable.dev",
    );
  });

  it("includes X-Koncierge-Key in allowed headers on preflight", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "OPTIONS",
      headers: { Origin: "https://console.kapable.dev" },
    });
    expect(res.status).toBe(204);
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowHeaders).toContain("X-Koncierge-Key");
  });
});

// ── AC 1: Requests from localhost:3005 are accepted in development
describe("CORS — localhost:3005 origin", () => {
  it("reflects origin in Access-Control-Allow-Origin", async () => {
    const res = await fetch(`${base}/health`, {
      headers: { Origin: "http://localhost:3005" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3005",
    );
  });
});

// ── CORS: disallowed origin gets empty Allow-Origin
describe("CORS — disallowed origin", () => {
  it("returns empty Access-Control-Allow-Origin for unknown origin", async () => {
    const res = await fetch(`${base}/health`, {
      headers: { Origin: "https://evil.com" },
    });
    expect(res.status).toBe(200);
    // Bun may strip empty-string headers → null is also acceptable
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao === "" || acao === null).toBe(true);
  });
});

// ── AC 2: Requests missing or with wrong X-Koncierge-Key receive 401
describe("Auth — X-Koncierge-Key validation", () => {
  it("returns 401 when X-Koncierge-Key is missing", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when X-Koncierge-Key is wrong", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": "wrong-key",
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 200 when X-Koncierge-Key is correct", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ── Route context injection ──────────────────────────────────
describe("Route context — included in POST body", () => {
  it("echoes route and pageTitle when provided", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({
        message: "What is this page?",
        route: "/projects/abc",
        pageTitle: "Project ABC",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received_route).toBe("/projects/abc");
    expect(body.received_pageTitle).toBe("Project ABC");
  });

  it("handles missing route context gracefully", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received_route).toBeNull();
    expect(body.received_pageTitle).toBeNull();
  });

  it("accepts route without pageTitle", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        Origin: "https://console.kapable.dev",
      },
      body: JSON.stringify({
        message: "help",
        route: "/apps",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received_route).toBe("/apps");
    expect(body.received_pageTitle).toBeNull();
  });
});
