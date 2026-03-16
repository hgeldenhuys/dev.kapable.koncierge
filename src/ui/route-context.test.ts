import { describe, it, expect } from "bun:test";
import { getRouteFromLocation, getPageTitleFromDocument } from "./route-context";

describe("getRouteFromLocation", () => {
  it("returns a string", () => {
    const result = getRouteFromLocation();
    expect(typeof result).toBe("string");
  });

  it("returns empty string in non-browser environment", () => {
    // Bun test runs without window.location — SSR-safe path returns ""
    if (typeof window === "undefined") {
      expect(getRouteFromLocation()).toBe("");
    }
  });
});

describe("getPageTitleFromDocument", () => {
  it("returns a string", () => {
    const result = getPageTitleFromDocument();
    expect(typeof result).toBe("string");
  });

  it("returns empty string in non-browser environment", () => {
    if (typeof document === "undefined") {
      expect(getPageTitleFromDocument()).toBe("");
    }
  });
});

describe("provider default wiring — adapter uses browser getters when none supplied", () => {
  it("sends SSR-safe defaults (empty strings) when using getRouteFromLocation/getPageTitleFromDocument", async () => {
    const { createKonciergeAdapter } = await import("./koncierge-adapter");

    let capturedBody: Record<string, unknown> | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"delta":"ok"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    try {
      // Simulate what KonciergeRuntimeProvider does:
      // config.getRoute ?? getRouteFromLocation
      // config.getPageTitle ?? getPageTitleFromDocument
      const adapter = createKonciergeAdapter({
        endpoint: "http://localhost:9999/test",
        getRoute: getRouteFromLocation,
        getPageTitle: getPageTitleFromDocument,
      });

      const gen = adapter.run({
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "hello" }],
            id: "msg-default",
            createdAt: new Date(),
            metadata: {} as never,
            status: { type: "complete" as const },
          },
        ],
        abortSignal: new AbortController().signal,
        config: {} as never,
        context: { useRender: (() => {}) as never, ReadonlyStore: (() => {}) as never } as never,
        unstable_assistantMessageId: "",
        onUpdate: () => {},
      });

      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      expect(capturedBody).not.toBeNull();
      // In SSR/Bun environment, browser getters return ""
      expect(capturedBody!.route).toBe("");
      expect(capturedBody!.pageTitle).toBe("");
      expect(capturedBody!.message).toBe("hello");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("adapter integration — route context in request body", () => {
  it("sends route and pageTitle in request body when callbacks are provided", async () => {
    const { createKonciergeAdapter } = await import("./koncierge-adapter");

    let capturedBody: Record<string, unknown> | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"delta":"ok"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    try {
      const adapter = createKonciergeAdapter({
        endpoint: "http://localhost:9999/test",
        getRoute: () => "/dashboard/pipelines",
        getPageTitle: () => "Pipeline Manager",
      });

      const gen = adapter.run({
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "hello" }],
            id: "msg-1",
            createdAt: new Date(),
            metadata: {} as never,
            status: { type: "complete" as const },
          },
        ],
        abortSignal: new AbortController().signal,
        config: {} as never,
        context: { useRender: (() => {}) as never, ReadonlyStore: (() => {}) as never } as never,
        unstable_assistantMessageId: "",
        onUpdate: () => {},
      });

      // Consume the generator
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.route).toBe("/dashboard/pipelines");
      expect(capturedBody!.pageTitle).toBe("Pipeline Manager");
      expect(capturedBody!.message).toBe("hello");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends undefined route/pageTitle when callbacks are not provided", async () => {
    const { createKonciergeAdapter } = await import("./koncierge-adapter");

    let capturedBody: Record<string, unknown> | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"delta":"ok"}\n\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    try {
      const adapter = createKonciergeAdapter({
        endpoint: "http://localhost:9999/test",
      });

      const gen = adapter.run({
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: "hi" }],
            id: "msg-2",
            createdAt: new Date(),
            metadata: {} as never,
            status: { type: "complete" as const },
          },
        ],
        abortSignal: new AbortController().signal,
        config: {} as never,
        context: { useRender: (() => {}) as never, ReadonlyStore: (() => {}) as never } as never,
        unstable_assistantMessageId: "",
        onUpdate: () => {},
      });

      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.route).toBeUndefined();
      expect(capturedBody!.pageTitle).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
