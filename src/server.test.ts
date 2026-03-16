import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const PORT = 3044; // Use a different port for tests
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  serverProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    env: {
      ...process.env,
      KONCIERGE_PORT: String(PORT),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "sk-test-placeholder",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Wait for server to be ready
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) break;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(100);
  }
});

afterAll(() => {
  serverProc?.kill();
});

describe("Koncierge API", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.model).toBeDefined();
  });

  test("POST /v1/koncierge/message rejects without auth", async () => {
    const res = await fetch(`${BASE_URL}/v1/koncierge/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  test("POST /v1/koncierge/message rejects empty message", async () => {
    const res = await fetch(`${BASE_URL}/v1/koncierge/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dev-token",
      },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /v1/koncierge/message accepts valid request with SSE content-type", async () => {
    // This test only checks that the endpoint accepts the request format
    // and returns the correct content type. Without a real API key, the
    // Anthropic call will fail but the SSE stream will contain an error event.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/v1/koncierge/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-token",
        },
        body: JSON.stringify({
          message: "What is the Data API?",
          route_context: "/dashboard",
        }),
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      // Read at least one SSE chunk
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      let chunks = 0;

      while (chunks < 5) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
        chunks++;
      }
      reader.releaseLock();

      // Should have received SSE-formatted data
      expect(received.length).toBeGreaterThan(0);
      // SSE lines contain "event:" and "data:" fields
      const hasSSEFormat =
        received.includes("event:") || received.includes("data:");
      expect(hasSSEFormat).toBe(true);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  test("POST /v1/koncierge/message accepts conversation_history", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/v1/koncierge/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dev-token",
        },
        body: JSON.stringify({
          message: "Tell me more",
          route_context: "/projects",
          conversation_history: [
            { role: "user", content: "What is Kapable?" },
            {
              role: "assistant",
              content: "Kapable is a platform for building apps.",
            },
          ],
        }),
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
});
