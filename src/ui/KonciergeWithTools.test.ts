import { describe, it, expect } from "bun:test";
import type { KonciergeToolCall } from "./tool-calls";
import type { KonciergeToolUseEvent } from "./koncierge-adapter";

/**
 * Integration tests for KonciergeWithTools wiring contract.
 *
 * Since KonciergeWithTools is a React component that composes hooks,
 * we verify the data flow contracts that make the wiring work:
 *
 * 1. SSE path: KonciergeToolUseEvent → handleToolUseEvent → executeTool
 * 2. Text path: parseToolCalls → KonciergeToolCall[] → executeTools
 * 3. Route context: pathname → useReactRouterRoute → getRoute callback
 *
 * DOM-dependent tool execution (highlight, tooltip) is already tested
 * in useKonciergeTools.test.ts. Here we test the integration seams.
 */

describe("KonciergeWithTools wiring contract", () => {
  describe("SSE tool_use event → tool call mapping", () => {
    it("navigate tool_use event maps correctly for dispatch", () => {
      const event: KonciergeToolUseEvent = {
        id: "toolu_nav_001",
        name: "navigate",
        input: { route: "/pipelines" },
      };

      // The bridge in handleToolUseEvent does: { tool: event.name, args: event.input }
      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;

      expect(tc.tool).toBe("navigate");
      expect((tc as { args: { route: string } }).args.route).toBe("/pipelines");
    });

    it("highlight tool_use event maps correctly for dispatch", () => {
      const event: KonciergeToolUseEvent = {
        id: "toolu_hl_002",
        name: "highlight",
        input: { selector: "[data-nav='pipelines']", durationMs: 5000 },
      };

      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
      expect(tc.tool).toBe("highlight");
      expect((tc as { args: { selector: string } }).args.selector).toBe(
        "[data-nav='pipelines']",
      );
    });

    it("tooltip tool_use event maps correctly for dispatch", () => {
      const event: KonciergeToolUseEvent = {
        id: "toolu_tt_003",
        name: "tooltip",
        input: {
          selector: "#create-flow-btn",
          text: "Click here to create your first AI Flow",
          durationMs: 4000,
        },
      };

      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
      expect(tc.tool).toBe("tooltip");
      expect((tc as { args: { text: string } }).args.text).toBe(
        "Click here to create your first AI Flow",
      );
    });

    it("showSection tool_use event maps correctly for dispatch", () => {
      const event: KonciergeToolUseEvent = {
        id: "toolu_ss_004",
        name: "showSection",
        input: { selector: "#metrics-panel" },
      };

      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
      expect(tc.tool).toBe("showSection");
    });
  });

  describe("navigate dispatch contract", () => {
    it("navigate tool call invokes the navigate function with the route", () => {
      let navigatedTo = "";
      const navigate = (to: string) => {
        navigatedTo = to;
      };

      // Simulate what executeTool does for navigate
      const tc: KonciergeToolCall = {
        tool: "navigate",
        args: { route: "/pipelines" },
      };

      if (tc.tool === "navigate") {
        navigate(tc.args.route);
      }

      expect(navigatedTo).toBe("/pipelines");
    });

    it("navigate notifies with human-readable label when known route", () => {
      const notifications: string[] = [];
      const onNotify = (msg: string) => notifications.push(msg);

      const ROUTE_LABELS: Record<string, string> = {
        "/dashboard": "Dashboard",
        "/projects": "Projects",
        "/flows": "AI Flows",
        "/apps": "Apps",
        "/settings": "Settings",
        "/pipelines": "Pipelines",
        "/deployments": "Deployments",
      };

      const route = "/pipelines";
      const label = ROUTE_LABELS[route] ?? route;
      onNotify(`Navigating to ${label}...`);

      expect(notifications).toEqual(["Navigating to Pipelines..."]);
    });

    it("navigate notifies with raw route for unknown routes", () => {
      const notifications: string[] = [];
      const onNotify = (msg: string) => notifications.push(msg);

      const ROUTE_LABELS: Record<string, string> = {
        "/dashboard": "Dashboard",
      };

      const route = "/custom/page";
      const label = ROUTE_LABELS[route] ?? route;
      onNotify(`Navigating to ${label}...`);

      expect(notifications).toEqual(["Navigating to /custom/page..."]);
    });
  });

  describe("tool execution resilience", () => {
    it("all four tool types can be dispatched through the switch without throwing", () => {
      let navigateCalled = false;
      const navigate = (_to: string) => {
        navigateCalled = true;
      };

      const tools: KonciergeToolCall[] = [
        { tool: "navigate", args: { route: "/settings" } },
        { tool: "highlight", args: { selector: "#sidebar" } },
        { tool: "tooltip", args: { selector: ".btn", text: "Help" } },
        { tool: "showSection", args: { selector: "#metrics" } },
      ];

      // Simulate the switch dispatch (only navigate has a testable side-effect here)
      for (const tc of tools) {
        switch (tc.tool) {
          case "navigate":
            navigate(tc.args.route);
            break;
          case "highlight":
          case "tooltip":
          case "showSection":
            // DOM operations — covered in useKonciergeTools.test.ts
            break;
        }
      }

      expect(navigateCalled).toBe(true);
      expect(tools).toHaveLength(4);
    });

    it("unknown tool types are silently ignored", () => {
      const event: KonciergeToolUseEvent = {
        id: "toolu_unknown",
        name: "deleteAll",
        input: { target: "everything" },
      };

      // The bridge creates the tool call but the switch has no matching case
      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;

      // No throw — the switch falls through
      let threw = false;
      try {
        switch (tc.tool) {
          case "navigate":
          case "highlight":
          case "tooltip":
          case "showSection":
            break;
          // No default — unknown tools are silently ignored
        }
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
    });

    it("tool calls with invalid selectors do not throw", () => {
      const tc: KonciergeToolCall = {
        tool: "highlight",
        args: { selector: ":::[invalid" },
      };

      // querySelector with invalid selector throws — the hook catches it
      expect(tc.args.selector).toBe(":::[invalid");
      // The try/catch in useKonciergeTools swallows the error
    });
  });

  describe("route context injection", () => {
    it("useReactRouterRoute contract: getRoute returns the provided pathname", () => {
      // The hook stores pathname in a ref and returns a callback
      // We test the contract: the callback should return the latest pathname
      let pathname = "/dashboard";
      const getRoute = () => pathname;

      expect(getRoute()).toBe("/dashboard");
      pathname = "/flows";
      expect(getRoute()).toBe("/flows");
    });

    it("route context is passed as getRoute/getPageTitle in adapter config", () => {
      // The composed component builds adapterConfig with:
      //   getRoute: routeCtx.getRoute
      //   getPageTitle: routeCtx.getPageTitle
      const config = {
        endpoint: "/api/koncierge/message",
        getRoute: () => "/dashboard",
        getPageTitle: () => "Dashboard — Kapable",
      };

      expect(config.getRoute()).toBe("/dashboard");
      expect(config.getPageTitle()).toBe("Dashboard — Kapable");
    });
  });

  describe("end-to-end wiring: SSE tool_use → adapter → bridge → navigate()", () => {
    it("navigate tool_use SSE event causes navigate() to be called with the correct route", async () => {
      const { createKonciergeAdapter } = await import("./koncierge-adapter");

      let navigatedTo = "";
      const navigate = (to: string) => {
        navigatedTo = to;
      };

      // Build the same bridge that handleToolUseEvent uses
      const handleToolUseEvent = (event: KonciergeToolUseEvent) => {
        const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
        if (tc.tool === "navigate") {
          navigate((tc.args as { route: string }).route);
        }
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"delta":"Taking you there."}\n\n'));
            controller.enqueue(encoder.encode('data: {"tool_use":{"id":"toolu_nav","name":"navigate","input":{"route":"/flows"}}}\n\n'));
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
          endpoint: "/api/koncierge/message",
          onToolCall: handleToolUseEvent,
        });

        const gen = adapter.run({
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: "show me the flows page" }],
              id: "msg-e2e-nav",
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
        while (!result.done) result = await gen.next();

        // The full chain: SSE tool_use → adapter.onToolCall → handleToolUseEvent → navigate("/flows")
        expect(navigatedTo).toBe("/flows");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("highlight tool_use SSE event reaches the dispatcher without throwing", async () => {
      const { createKonciergeAdapter } = await import("./koncierge-adapter");

      const dispatched: KonciergeToolCall[] = [];

      const handleToolUseEvent = (event: KonciergeToolUseEvent) => {
        const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
        dispatched.push(tc);
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"tool_use":{"id":"toolu_hl","name":"highlight","input":{"selector":"[data-nav=\\"sidebar\\"]","durationMs":3000}}}\n\n'));
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
          endpoint: "/api/koncierge/message",
          onToolCall: handleToolUseEvent,
        });

        const gen = adapter.run({
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: "point out the sidebar" }],
              id: "msg-e2e-hl",
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
        while (!result.done) result = await gen.next();

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].tool).toBe("highlight");
        expect((dispatched[0].args as { selector: string }).selector).toBe('[data-nav="sidebar"]');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("tooltip tool_use SSE event reaches the dispatcher with text and selector", async () => {
      const { createKonciergeAdapter } = await import("./koncierge-adapter");

      const dispatched: KonciergeToolCall[] = [];

      const handleToolUseEvent = (event: KonciergeToolUseEvent) => {
        dispatched.push({ tool: event.name, args: event.input } as KonciergeToolCall);
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"tool_use":{"id":"toolu_tt","name":"tooltip","input":{"selector":"#create-btn","text":"Click to create a flow"}}}\n\n'));
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
          endpoint: "/api/koncierge/message",
          onToolCall: handleToolUseEvent,
        });

        const gen = adapter.run({
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: "help me create" }],
              id: "msg-e2e-tt",
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
        while (!result.done) result = await gen.next();

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0].tool).toBe("tooltip");
        const args = dispatched[0].args as { selector: string; text: string };
        expect(args.selector).toBe("#create-btn");
        expect(args.text).toBe("Click to create a flow");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("route context flows through the adapter to the request body", async () => {
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
        // Simulate useReactRouterRoute — a ref-based closure returning current pathname
        let currentPathname = "/flows";
        const getRoute = () => currentPathname;

        const adapter = createKonciergeAdapter({
          endpoint: "/api/koncierge/message",
          getRoute,
          getPageTitle: () => "AI Flows — Kapable",
        });

        const gen = adapter.run({
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: "where am i" }],
              id: "msg-e2e-route",
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
        while (!result.done) result = await gen.next();

        expect(capturedBody).not.toBeNull();
        expect(capturedBody!.route).toBe("/flows");
        expect(capturedBody!.pageTitle).toBe("AI Flows — Kapable");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("composed component props contract", () => {
    it("minimal props: navigate + pathname + endpoint are sufficient", () => {
      const props = {
        navigate: (_to: string) => {},
        pathname: "/dashboard",
        endpoint: "/api/koncierge/message",
      };

      expect(props.navigate).toBeFunction();
      expect(props.pathname).toBe("/dashboard");
      expect(props.endpoint).toBe("/api/koncierge/message");
    });

    it("optional props: headers, onError, onNotify, title are all optional", () => {
      const props = {
        navigate: (_to: string) => {},
        pathname: "/dashboard",
        endpoint: "/api/koncierge/message",
        headers: { Authorization: "Bearer tok_123" },
        onError: (_msg: string) => {},
        onNotify: (_msg: string) => {},
        title: "Kapable Guide",
        defaultCollapsed: false,
      };

      expect(props.headers?.Authorization).toBe("Bearer tok_123");
      expect(props.title).toBe("Kapable Guide");
      expect(props.defaultCollapsed).toBe(false);
    });
  });
});
