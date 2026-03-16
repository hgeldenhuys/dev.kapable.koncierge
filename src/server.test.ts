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

  // ── Auth on /v1/* routes ──────────────────────────────────────

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

  // ── /message (BFF proxy endpoint, no auth) ───────────────────

  test("POST /message rejects empty message", async () => {
    const res = await fetch(`${BASE_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("message is required");
  });

  test("POST /message does NOT require auth (BFF path)", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "What is the Data API?",
          route_context: { path: "/dashboard", role: "admin", orgName: "Acme" },
        }),
        signal: controller.signal,
      });

      // Should not get 401 — BFF endpoint has no auth middleware
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  test("POST /message accepts route_context as object {path, role, orgName}", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hello",
          route_context: { path: "/projects", role: "member", orgName: "TestOrg" },
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

  test("POST /message accepts route_context as legacy string", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hello",
          route_context: "/dashboard",
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

  test("POST /message accepts session_id parameter", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Tell me about pipelines",
          session_id: "sess_abc123",
          route_context: { path: "/pipelines" },
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

  // ── SSE format ────────────────────────────────────────────────

  test("POST /message emits SSE with TextDelta/Done/Error format", async () => {
    // Without a real Anthropic key, we expect an Error event in the stream.
    // This validates the SSE format matches what the frontend expects.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${BASE_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "test" }),
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      // Read the SSE stream
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      let chunks = 0;

      while (chunks < 10) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value, { stream: true });
        chunks++;
      }
      reader.releaseLock();

      // Stream should contain SSE-formatted data
      expect(received.length).toBeGreaterThan(0);
      expect(received).toContain("data:");

      // Parse the SSE events and check format
      const dataLines = received.split("\n").filter((l) => l.startsWith("data:"));
      expect(dataLines.length).toBeGreaterThan(0);

      // Each data line should be valid JSON with a recognized type
      for (const line of dataLines) {
        const payload = line.replace(/^data:\s*/, "");
        const event = JSON.parse(payload);
        // Must be one of the types the frontend expects
        expect(["TextDelta", "MessageStart", "Done", "Error"]).toContain(event.type);

        // TextDelta must have 'text' field (not 'content')
        if (event.type === "TextDelta") {
          expect(event.text).toBeDefined();
        }
        // Error must have 'error' field (not 'message')
        if (event.type === "Error") {
          expect(event.error).toBeDefined();
        }
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  // ── /v1/koncierge/message with auth (backwards compat) ───────

  test("POST /v1/koncierge/message accepts valid request with SSE content-type", async () => {
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

      expect(received.length).toBeGreaterThan(0);
      expect(received).toContain("data:");
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
          route_context: { path: "/projects" },
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
