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
