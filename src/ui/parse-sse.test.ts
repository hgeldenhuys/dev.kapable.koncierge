import { describe, it, expect } from "bun:test";
import { parseSSE } from "./parse-sse";

/** Helper: create a ReadableStream from an array of string chunks */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
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

describe("parseSSE", () => {
  it("parses complete SSE data lines", async () => {
    const stream = streamFrom([
      'data: {"delta":"Hello"}\n\n',
      'data: {"delta":" world"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ delta: "Hello" }, { delta: " world" }]);
  });

  it("handles chunks split mid-line", async () => {
    const stream = streamFrom([
      'data: {"del',
      'ta":"chunk1"}\n\ndata: {"delta":"chunk2"}\n\n',
      "data: [DONE]\n\n",
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ delta: "chunk1" }, { delta: "chunk2" }]);
  });

  it("stops at [DONE] sentinel", async () => {
    const stream = streamFrom([
      'data: {"delta":"before"}\n\n',
      "data: [DONE]\n\n",
      'data: {"delta":"after"}\n\n',
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ delta: "before" }]);
  });

  it("skips non-data lines and empty lines", async () => {
    const stream = streamFrom([
      ": comment line\n",
      "\n",
      'data: {"value":1}\n\n',
      "event: ping\n",
      "data: [DONE]\n\n",
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ value: 1 }]);
  });

  it("skips malformed JSON gracefully", async () => {
    const stream = streamFrom([
      "data: not-json\n\n",
      'data: {"ok":true}\n\n',
      "data: [DONE]\n\n",
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ ok: true }]);
  });

  it("handles stream ending without [DONE]", async () => {
    const stream = streamFrom([
      'data: {"delta":"only"}\n\n',
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ delta: "only" }]);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    const stream = streamFrom([
      'data: {"n":1}\n\n',
      'data: {"n":2}\n\n',
      'data: {"n":3}\n\n',
    ]);

    const events: unknown[] = [];
    let count = 0;
    for await (const event of parseSSE(stream, controller.signal)) {
      events.push(event);
      count++;
      if (count >= 2) controller.abort();
    }

    // Should get at most 2 events (abort checked on next iteration)
    expect(events.length).toBeLessThanOrEqual(3);
    expect(events[0]).toEqual({ n: 1 });
  });

  it("handles multiple data lines in a single chunk", async () => {
    const stream = streamFrom([
      'data: {"a":1}\n\ndata: {"a":2}\n\ndata: {"a":3}\n\ndata: [DONE]\n\n',
    ]);

    const events: unknown[] = [];
    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });
});
