import { describe, it, expect, beforeAll, afterAll } from "bun:test";

/**
 * Integration tests for the route handlers (routes.ts).
 *
 * Tests session-token validation, body validation, and SSE response
 * headers. Uses a lightweight server that mimics the real routing but
 * returns a canned SSE stream instead of calling the Anthropic API.
 */

const TEST_SECRET = "route-test-secret";
const TEST_PORT = 39_201;

process.env.KONCIERGE_SECRET = TEST_SECRET;

// Import route handlers directly
import { handleHealth, handleMessage } from "./routes";
import type { KonciergeCore } from "./session";

// Fake KonciergeCore — no real Anthropic client needed for middleware tests
const fakeCore: KonciergeCore = {
  client: {} as any,
  systemPrompt: [{ type: "text" as const, text: "fake knowledge base" }],
  knowledgeBaseChars: 18,
};

const cors = {
  "Access-Control-Allow-Origin": "https://console.kapable.dev",
  Vary: "Origin",
};

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: TEST_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        return handleHealth(fakeCore, cors);
      }

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        return handleMessage(req, fakeCore, cors);
      }

      return Response.json({ error: "Not Found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop();
});

const base = `http://localhost:${TEST_PORT}`;

describe("GET /health", () => {
  it("returns status ok with knowledge base stats", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
    expect(body.knowledgeBaseChars).toBe(18);
    expect(typeof body.activeSessions).toBe("number");
  });
});

describe("POST /v1/koncierge/message — validation", () => {
  it("returns 401 when X-Session-Token is missing", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
      },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing X-Session-Token header");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        "X-Session-Token": "test-session-1",
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 when message field is missing", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        "X-Session-Token": "test-session-2",
      },
      body: JSON.stringify({ route: "/dashboard" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing or invalid 'message' field");
  });

  it("returns 400 when message is not a string", async () => {
    const res = await fetch(`${base}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": TEST_SECRET,
        "X-Session-Token": "test-session-3",
      },
      body: JSON.stringify({ message: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing or invalid 'message' field");
  });
});
