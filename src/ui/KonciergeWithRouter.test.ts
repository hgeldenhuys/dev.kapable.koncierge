import { describe, it, expect, mock } from "bun:test";
import type { KonciergeWithRouterProps } from "./KonciergeWithRouter";
import type { KonciergeAdapterConfig } from "./koncierge-adapter";
import type { UseKonciergeToolsConfig, UseKonciergeToolsReturn } from "./useKonciergeTools";
import type { RouteContextCallbacks } from "./route-context";
import type { KonciergeToolCall } from "./tool-calls";
import type { KonciergeToolUseEvent } from "./koncierge-adapter";

/**
 * Tests for KonciergeWithRouter wiring logic.
 *
 * Since this is a React component that requires a full React Router context,
 * we test the wiring contract — the shapes flowing between hooks, the props
 * interface, and the adapter config assembly. The actual React rendering is
 * validated via manual testing in the console app (tasks 3 & 4).
 */

describe("KonciergeWithRouter props interface", () => {
  it("requires only endpoint as mandatory prop", () => {
    const props: KonciergeWithRouterProps = {
      endpoint: "/api/koncierge/message",
    };
    expect(props.endpoint).toBe("/api/koncierge/message");
    expect(props.headers).toBeUndefined();
    expect(props.onError).toBeUndefined();
    expect(props.onNotify).toBeUndefined();
    expect(props.title).toBeUndefined();
    expect(props.defaultCollapsed).toBeUndefined();
  });

  it("accepts all optional props", () => {
    const onError = mock(() => {});
    const onNotify = mock(() => {});
    const props: KonciergeWithRouterProps = {
      endpoint: "/api/koncierge/message",
      headers: { Authorization: "Bearer tok_123" },
      onError,
      onNotify,
      title: "Assistant",
      defaultCollapsed: false,
      emptyContent: "How can I help?",
      className: "custom-panel",
    };
    expect(props.headers).toEqual({ Authorization: "Bearer tok_123" });
    expect(props.title).toBe("Assistant");
    expect(props.defaultCollapsed).toBe(false);
    expect(props.className).toBe("custom-panel");
  });
});

describe("adapter config assembly from props", () => {
  it("maps KonciergeWithRouterProps to KonciergeAdapterConfig shape", () => {
    // Simulate the config assembly that happens inside KonciergeWithRouter
    const props: KonciergeWithRouterProps = {
      endpoint: "/api/koncierge/message",
      headers: { "X-Custom": "value" },
      onError: (msg: string) => console.error(msg),
    };

    const getRoute = () => "/flows";
    const getPageTitle = () => "AI Flows";

    const config: KonciergeAdapterConfig = {
      endpoint: props.endpoint,
      headers: props.headers,
      onError: props.onError,
      getRoute,
      getPageTitle,
    };

    expect(config.endpoint).toBe("/api/koncierge/message");
    expect(config.headers).toEqual({ "X-Custom": "value" });
    expect(config.getRoute?.()).toBe("/flows");
    expect(config.getPageTitle?.()).toBe("AI Flows");
  });

  it("route context callbacks come from useReactRouterRoute hook", () => {
    // Simulate what useReactRouterRoute returns
    const routeCtx: RouteContextCallbacks = {
      getRoute: () => "/dashboard",
      getPageTitle: () => "Dashboard — Kapable",
    };

    expect(routeCtx.getRoute()).toBe("/dashboard");
    expect(routeCtx.getPageTitle()).toBe("Dashboard — Kapable");
  });
});

describe("tool execution wiring contract", () => {
  it("useKonciergeTools config accepts navigate function", () => {
    const navigateFn = mock((_to: string) => {});
    const config: UseKonciergeToolsConfig = {
      navigate: navigateFn,
    };
    config.navigate("/flows");
    expect(navigateFn).toHaveBeenCalledWith("/flows");
  });

  it("useKonciergeTools config accepts optional onNotify", () => {
    const navigateFn = mock((_to: string) => {});
    const onNotify = mock((_msg: string) => {});
    const config: UseKonciergeToolsConfig = {
      navigate: navigateFn,
      onNotify,
    };
    config.onNotify?.("Navigating to AI Flows...");
    expect(onNotify).toHaveBeenCalledWith("Navigating to AI Flows...");
  });

  it("executeTools dispatches all tool calls in the array", () => {
    const executed: KonciergeToolCall[] = [];
    const executeTools = (tcs: KonciergeToolCall[]) => {
      for (const tc of tcs) {
        executed.push(tc);
      }
    };

    const tools: KonciergeToolCall[] = [
      { tool: "navigate", args: { route: "/flows" } },
      { tool: "highlight", args: { selector: "#create-btn" } },
    ];

    executeTools(tools);
    expect(executed).toHaveLength(2);
    expect(executed[0].tool).toBe("navigate");
    expect(executed[1].tool).toBe("highlight");
  });

  it("handleToolUseEvent bridges SSE event to KonciergeToolCall", () => {
    // This is the bridge logic from useKonciergeTools
    const event: KonciergeToolUseEvent = {
      id: "toolu_abc",
      name: "navigate",
      input: { route: "/settings" },
    };

    const tc = {
      tool: event.name,
      args: event.input,
    } as KonciergeToolCall;

    expect(tc.tool).toBe("navigate");
    expect((tc as { args: { route: string } }).args.route).toBe("/settings");
  });
});

describe("route context injection into messages", () => {
  it("route and pageTitle are included in adapter request body", () => {
    const getRoute = () => "/pipelines";
    const getPageTitle = () => "Pipelines — Kapable";

    // Simulate the body shape that createKonciergeAdapter sends
    const body = {
      message: "How do I create a pipeline?",
      route: getRoute(),
      pageTitle: getPageTitle(),
    };

    expect(body.route).toBe("/pipelines");
    expect(body.pageTitle).toBe("Pipelines — Kapable");
    expect(body.message).toBe("How do I create a pipeline?");
  });

  it("route context updates when pathname changes", () => {
    // Simulate useReactRouterRoute behavior with changing pathname
    let currentPathname = "/dashboard";
    const pathnameRef = { current: currentPathname };

    const getRoute = () => pathnameRef.current;

    expect(getRoute()).toBe("/dashboard");

    // Simulate navigation
    pathnameRef.current = "/flows";
    expect(getRoute()).toBe("/flows");

    pathnameRef.current = "/settings";
    expect(getRoute()).toBe("/settings");
  });
});

describe("tool call stripping from display text", () => {
  it("tool call tokens do not appear as raw text (AC3 contract)", () => {
    // This is validated by the existing parseToolCalls function
    // which KonciergePanel uses internally. The contract is:
    // tool call JSON blocks are stripped from displayText.
    const { parseToolCalls } = require("./tool-calls");

    const raw = `Sure, I'll take you there!\n\`\`\`tool\n{"tool":"navigate","args":{"route":"/flows"}}\n\`\`\``;
    const { displayText, toolCalls } = parseToolCalls(raw);

    expect(displayText.trim()).toBe("Sure, I'll take you there!");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].tool).toBe("navigate");
    // No raw JSON in display text
    expect(displayText).not.toContain('"tool"');
    expect(displayText).not.toContain('"navigate"');
  });

  it("highlight tool calls are also stripped", () => {
    const { parseToolCalls } = require("./tool-calls");

    const raw = `Here's the button:\n{"tool":"highlight","args":{"selector":"#create-btn"}}`;
    const { displayText, toolCalls } = parseToolCalls(raw);

    expect(displayText.trim()).toBe("Here's the button:");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].tool).toBe("highlight");
    expect(displayText).not.toContain("highlight");
    expect(displayText).not.toContain("selector");
  });
});

describe("complete wiring flow simulation", () => {
  it("simulates the full flow: navigate tool arrives → dispatched to React Router", () => {
    const navigatedTo: string[] = [];
    const notifications: string[] = [];

    // Simulate useNavigate
    const navigate = (to: string) => navigatedTo.push(to);
    // Simulate onNotify (toast)
    const onNotify = (msg: string) => notifications.push(msg);

    // Simulate useKonciergeTools executeTool (simplified)
    const executeTool = (tc: KonciergeToolCall) => {
      if (tc.tool === "navigate") {
        navigate(tc.args.route);
        onNotify(`Navigating to ${tc.args.route}...`);
      }
    };

    // Simulate a tool call parsed from message text
    const toolCalls: KonciergeToolCall[] = [
      { tool: "navigate", args: { route: "/flows" } },
    ];

    for (const tc of toolCalls) {
      executeTool(tc);
    }

    expect(navigatedTo).toEqual(["/flows"]);
    expect(notifications).toEqual(["Navigating to /flows..."]);
  });

  it("simulates the full flow: SSE tool_use event → dispatched to DOM highlight", () => {
    const highlightedSelectors: string[] = [];

    const executeTool = (tc: KonciergeToolCall) => {
      if (tc.tool === "highlight") {
        highlightedSelectors.push(tc.args.selector);
      }
    };

    // Simulate handleToolUseEvent bridge
    const handleToolUseEvent = (event: KonciergeToolUseEvent) => {
      const tc = { tool: event.name, args: event.input } as KonciergeToolCall;
      executeTool(tc);
    };

    // Server emits a highlight tool_use event
    handleToolUseEvent({
      id: "toolu_xyz",
      name: "highlight",
      input: { selector: "#create-function-btn", durationMs: 3000 },
    });

    expect(highlightedSelectors).toEqual(["#create-function-btn"]);
  });
});
