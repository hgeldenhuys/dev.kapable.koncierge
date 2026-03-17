import { describe, it, expect, afterEach } from "bun:test";
import { createKonciergeAdapter } from "./koncierge-adapter";

/** Build a minimal ChatModelRunOptions-compatible input */
function makeRunOptions(
  text: string,
  signal?: AbortSignal,
) {
  return {
    messages: [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text }],
        id: "msg-1",
        createdAt: new Date(),
        metadata: {} as never,
        status: { type: "complete" as const },
      },
    ],
    abortSignal: signal ?? new AbortController().signal,
    config: {} as never,
    context: {
      useRender: (() => {}) as never,
      ReadonlyStore: (() => {}) as never,
    } as never,
    unstable_assistantMessageId: "",
    onUpdate: () => {},
  };
}

/** Helper: create a ReadableStream that emits SSE chunks */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/** Mock fetch that returns an SSE response */
function mockFetch(chunks: string[], status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(sseStream(chunks), {
      status,
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  return original;
}

/** Mock fetch that captures the request body */
function mockFetchCapture(chunks: string[]) {
  const original = globalThis.fetch;
  let captured: Record<string, unknown> | null = null;

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured = JSON.parse(init?.body as string);
    return new Response(sseStream(chunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  };

  return { original, getCaptured: () => captured };
}

let savedFetch: typeof globalThis.fetch | null = null;

afterEach(() => {
  if (savedFetch) {
    globalThis.fetch = savedFetch;
    savedFetch = null;
  }
});

describe("createKonciergeAdapter", () => {
  it("streams text deltas and accumulates full text", async () => {
    savedFetch = mockFetch([
      'data: {"delta":"Hello"}\n\n',
      'data: {"delta":" world"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const adapter = createKonciergeAdapter({ endpoint: "/test" });
    const gen = adapter.run(makeRunOptions("hi"));

    const yields: Array<{ content: Array<{ type: string; text: string }> }> = [];
    let result = await gen.next();
    while (!result.done) {
      yields.push(result.value as never);
      result = await gen.next();
    }

    // Should yield incrementally: 2 delta yields + 1 final yield
    expect(yields.length).toBe(3);
    expect(yields[0].content[0].text).toBe("Hello");
    expect(yields[1].content[0].text).toBe("Hello world");
    // Final yield has complete text
    expect(yields[2].content[0].text).toBe("Hello world");
  });

  it("sends message, route, and pageTitle in request body", async () => {
    const { original, getCaptured } = mockFetchCapture([
      'data: {"delta":"ok"}\n\n',
      "data: [DONE]\n\n",
    ]);
    savedFetch = original;

    const adapter = createKonciergeAdapter({
      endpoint: "/api/koncierge/message",
      getRoute: () => "/dashboard/pipelines",
      getPageTitle: () => "Pipeline Manager",
    });

    const gen = adapter.run(makeRunOptions("what is this?"));
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    const body = getCaptured();
    expect(body).not.toBeNull();
    expect(body!.message).toBe("what is this?");
    expect(body!.route).toBe("/dashboard/pipelines");
    expect(body!.pageTitle).toBe("Pipeline Manager");
  });

  it("includes custom headers in the request", async () => {
    const original = globalThis.fetch;
    let capturedHeaders: Headers | null = null;

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        sseStream(['data: {"delta":"ok"}\n\ndata: [DONE]\n\n']),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
    savedFetch = original;

    const adapter = createKonciergeAdapter({
      endpoint: "/test",
      headers: { "X-Koncierge-Key": "secret123" },
    });

    const gen = adapter.run(makeRunOptions("hi"));
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("X-Koncierge-Key")).toBe("secret123");
    expect(capturedHeaders!.get("Content-Type")).toBe("application/json");
  });

  it("yields error message and calls onError on non-OK response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "Bad request" }), {
        status: 400,
      });
    };
    savedFetch = original;

    const errors: string[] = [];
    const adapter = createKonciergeAdapter({
      endpoint: "/test",
      onError: (msg) => errors.push(msg),
    });
    const gen = adapter.run(makeRunOptions("hi"));

    const yields: Array<{ content: Array<{ type: string; text: string }> }> = [];
    let result = await gen.next();
    while (!result.done) {
      yields.push(result.value as never);
      result = await gen.next();
    }

    // Should yield a user-friendly error message
    expect(yields.length).toBeGreaterThanOrEqual(1);
    expect(yields[0].content[0].text).toContain("Sorry");
    // Should have called onError with status code
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("400");
  });

  it("yields error text and calls onError on SSE error event", async () => {
    savedFetch = mockFetch([
      'data: {"error":"Rate limited"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const errors: string[] = [];
    const adapter = createKonciergeAdapter({
      endpoint: "/test",
      onError: (msg) => errors.push(msg),
    });
    const gen = adapter.run(makeRunOptions("hi"));

    const yields: Array<{ content: Array<{ type: string; text: string }> }> = [];
    let result = await gen.next();
    while (!result.done) {
      yields.push(result.value as never);
      result = await gen.next();
    }

    // The adapter shows a friendly message to the user (not the raw error)
    const lastText = yields[yields.length - 1].content[0].text;
    expect(lastText).toContain("Sorry, I ran into an issue");
    // The raw error is passed to onError for toast/logging
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Rate limited");
  });

  it("handles empty delta stream gracefully", async () => {
    savedFetch = mockFetch(["data: [DONE]\n\n"]);

    const adapter = createKonciergeAdapter({ endpoint: "/test" });
    const gen = adapter.run(makeRunOptions("hi"));

    const result = await gen.next();
    // Generator yields final empty text then completes
    expect(result.done).toBe(false);
    expect((result.value as { content: Array<{ text: string }> }).content[0].text).toBe("");
    const done = await gen.next();
    expect(done.done).toBe(true);
  });

  it("never sends X-Session-Token from the client (token is set server-side by BFF)", async () => {
    const original = globalThis.fetch;
    let capturedHeaders: Headers | null = null;

    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        sseStream(['data: {"delta":"ok"}\n\ndata: [DONE]\n\n']),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    };
    savedFetch = original;

    const adapter = createKonciergeAdapter({ endpoint: "/test" });

    const gen = adapter.run(makeRunOptions("hi"));
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get("X-Session-Token")).toBeNull();
  });

  it("calls onToolCall when a tool_use SSE event is received", async () => {
    savedFetch = mockFetch([
      'data: {"delta":"Let me navigate you."}\n\n',
      'data: {"tool_use":{"id":"toolu_1","name":"navigate","input":{"route":"/flows"}}}\n\n',
      "data: [DONE]\n\n",
    ]);

    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const adapter = createKonciergeAdapter({
      endpoint: "/test",
      onToolCall: (tc) => toolCalls.push(tc),
    });
    const gen = adapter.run(makeRunOptions("take me to flows"));

    const yields: Array<{ content: Array<{ type: string; text: string }> }> = [];
    let result = await gen.next();
    while (!result.done) {
      yields.push(result.value as never);
      result = await gen.next();
    }

    // Tool call should have been dispatched
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe("navigate");
    expect(toolCalls[0].input).toEqual({ route: "/flows" });

    // Text should still accumulate normally (tool_use events don't add to text)
    const lastText = yields[yields.length - 1].content[0].text;
    expect(lastText).toBe("Let me navigate you.");
  });

  it("handles tool_use events without onToolCall callback", async () => {
    savedFetch = mockFetch([
      'data: {"tool_use":{"id":"toolu_2","name":"highlight","input":{"selector":"#btn"}}}\n\n',
      "data: [DONE]\n\n",
    ]);

    // No onToolCall callback — should not throw
    const adapter = createKonciergeAdapter({ endpoint: "/test" });
    const gen = adapter.run(makeRunOptions("highlight something"));
    let result = await gen.next();
    while (!result.done) result = await gen.next();
    // If we get here without error, the test passes
    expect(true).toBe(true);
  });

  it("extracts text from multi-part user messages", async () => {
    const { original, getCaptured } = mockFetchCapture([
      'data: {"delta":"ok"}\n\ndata: [DONE]\n\n',
    ]);
    savedFetch = original;

    const adapter = createKonciergeAdapter({ endpoint: "/test" });
    const gen = adapter.run({
      messages: [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "part1 " },
            { type: "text" as const, text: "part2" },
          ],
          id: "msg-1",
          createdAt: new Date(),
          metadata: {} as never,
          status: { type: "complete" as const },
        },
      ],
      abortSignal: new AbortController().signal,
      config: {} as never,
      context: {
        useRender: (() => {}) as never,
        ReadonlyStore: (() => {}) as never,
      } as never,
      unstable_assistantMessageId: "",
      onUpdate: () => {},
    });

    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(getCaptured()!.message).toBe("part1 part2");
  });
});
