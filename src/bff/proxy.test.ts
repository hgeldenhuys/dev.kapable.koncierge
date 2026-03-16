import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  handleKonciergeProxy,
  configFromEnv,
  proxyKonciergeMessage,
  type BffProxyConfig,
} from "./proxy";

/**
 * Integration tests for the BFF proxy.
 *
 * Spins up a mock "Koncierge backend" on a random port that validates
 * headers and returns SSE data, then tests the proxy against it.
 */

const TEST_SECRET = "proxy-test-secret-xyz";
const MOCK_PORT = 39_201;
const MOCK_URL = `http://localhost:${MOCK_PORT}`;

let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  mockServer = Bun.serve({
    port: MOCK_PORT,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
        // Validate X-Koncierge-Key
        const apiKey = req.headers.get("X-Koncierge-Key");
        if (apiKey !== TEST_SECRET) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Validate X-Session-Token is forwarded
        const sessionToken = req.headers.get("X-Session-Token");
        if (!sessionToken) {
          return Response.json(
            { error: "Missing session token" },
            { status: 401 },
          );
        }

        // Parse body
        const body = await req.json();

        // Return SSE stream with a few chunks
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: "Hello " })}\n\n`),
            );
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: `${body.message}!` })}\n\n`),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      return Response.json({ error: "Not Found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer.stop();
});

const validConfig: BffProxyConfig = {
  konciergeUrl: MOCK_URL,
  konciergeSecret: TEST_SECRET,
};

function makeRequest(body: unknown): Request {
  return new Request(`${MOCK_URL}/api/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── AC: Valid request streams SSE back ──────────────────────────
describe("BFF proxy — valid request", () => {
  it("streams SSE response from upstream", async () => {
    const req = makeRequest({ message: "world" });
    const res = await handleKonciergeProxy(req, validConfig, "user-session-123");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain('{"delta":"Hello "}');
    expect(text).toContain('{"delta":"world!"}');
    expect(text).toContain("[DONE]");
  });

  it("forwards X-Session-Token to upstream", async () => {
    const req = makeRequest({ message: "test" });
    const res = await handleKonciergeProxy(req, validConfig, "my-session-tok");

    // If session token wasn't forwarded, mock returns 401
    expect(res.status).toBe(200);
  });
});

// ── AC: Missing session token returns 401 ──────────────────────
describe("BFF proxy — missing session token", () => {
  it("returns 401 when session token is null", async () => {
    const req = makeRequest({ message: "hello" });
    const res = await handleKonciergeProxy(req, validConfig, null);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("session token");
  });
});

// ── AC: Missing config returns 503 ─────────────────────────────
describe("BFF proxy — missing config", () => {
  it("returns 503 when config is null", async () => {
    const req = makeRequest({ message: "hello" });
    const res = await handleKonciergeProxy(req, null, "user-session-123");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("not configured");
  });
});

// ── AC: Invalid body returns 400 ───────────────────────────────
describe("BFF proxy — invalid body", () => {
  it("returns 400 for missing message field", async () => {
    const req = makeRequest({ notMessage: "oops" });
    const res = await handleKonciergeProxy(req, validConfig, "user-session-123");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("message");
  });

  it("returns 400 for non-string message", async () => {
    const req = makeRequest({ message: 42 });
    const res = await handleKonciergeProxy(req, validConfig, "user-session-123");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("message");
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new Request(`${MOCK_URL}/api/koncierge/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    const res = await handleKonciergeProxy(req, validConfig, "user-session-123");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });
});

// ── AC: Upstream error is relayed ──────────────────────────────
describe("BFF proxy — upstream error relay", () => {
  it("relays upstream 401 when secret is wrong", async () => {
    const badConfig: BffProxyConfig = {
      konciergeUrl: MOCK_URL,
      konciergeSecret: "wrong-secret",
    };

    const req = makeRequest({ message: "hello" });
    const res = await handleKonciergeProxy(req, badConfig, "user-session-123");

    expect(res.status).toBe(401);
  });
});

// ── AC: Unreachable backend returns 502 ────────────────────────
describe("BFF proxy — unreachable backend", () => {
  it("returns 502 when backend is down", async () => {
    const deadConfig: BffProxyConfig = {
      konciergeUrl: "http://localhost:1", // nothing listens here
      konciergeSecret: TEST_SECRET,
    };

    const req = makeRequest({ message: "hello" });
    const res = await handleKonciergeProxy(req, deadConfig, "user-session-123");

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toContain("unreachable");
  });
});

// ── configFromEnv ──────────────────────────────────────────────
describe("configFromEnv", () => {
  it("returns null when KONCIERGE_URL is missing", () => {
    const origUrl = process.env.KONCIERGE_URL;
    const origSecret = process.env.KONCIERGE_SECRET;
    delete process.env.KONCIERGE_URL;
    process.env.KONCIERGE_SECRET = "secret";

    expect(configFromEnv()).toBeNull();

    // Restore
    if (origUrl !== undefined) process.env.KONCIERGE_URL = origUrl;
    else delete process.env.KONCIERGE_URL;
    if (origSecret !== undefined) process.env.KONCIERGE_SECRET = origSecret;
    else delete process.env.KONCIERGE_SECRET;
  });

  it("returns config when both vars are set", () => {
    const origUrl = process.env.KONCIERGE_URL;
    const origSecret = process.env.KONCIERGE_SECRET;
    process.env.KONCIERGE_URL = "http://koncierge:3101/";
    process.env.KONCIERGE_SECRET = "my-secret";

    const config = configFromEnv();
    expect(config).not.toBeNull();
    expect(config!.konciergeUrl).toBe("http://koncierge:3101"); // trailing slash stripped
    expect(config!.konciergeSecret).toBe("my-secret");

    // Restore
    if (origUrl !== undefined) process.env.KONCIERGE_URL = origUrl;
    else delete process.env.KONCIERGE_URL;
    if (origSecret !== undefined) process.env.KONCIERGE_SECRET = origSecret;
    else delete process.env.KONCIERGE_SECRET;
  });
});

// ── proxyKonciergeMessage — route/pageTitle forwarding ─────────
describe("BFF proxy — route context forwarding", () => {
  it("forwards route and pageTitle to upstream", async () => {
    const req = makeRequest({
      message: "help",
      route: "/settings/team",
      pageTitle: "Team Settings",
    });
    const result = await proxyKonciergeMessage(req, validConfig, "session-abc");

    expect(result.status).toBe(200);
    // The mock echoes back the message in the SSE data
    const text =
      typeof result.body === "string"
        ? result.body
        : await new Response(result.body).text();
    expect(text).toContain("help!");
  });
});
