import { describe, it, expect } from "bun:test";
import { buildUserMessage, appendAssistantMessage, KONCIERGE_TOOLS, type RouteContext, type ConversationSession } from "./session";
import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

describe("smoke test — route context reaches Claude prompt (simulated /flows navigation)", () => {
  it("adapter → proxy body → buildUserMessage produces context-prefixed prompt for /flows", async () => {
    // Simulate the full pipeline:
    // 1. Adapter sends { message, route, pageTitle } to BFF
    // 2. BFF proxy forwards verbatim to upstream
    // 3. Server extracts route/pageTitle and calls buildUserMessage

    // Step 1+2: The adapter sends route and pageTitle in the body.
    // The BFF proxy forwards the raw JSON body to upstream.
    // Simulate what the upstream server receives:
    const upstreamBody = {
      message: "what is this page?",
      route: "/flows",
      pageTitle: "AI Flows",
    };

    // Step 3: Server calls buildUserMessage with the extracted context
    const prompt = buildUserMessage(upstreamBody.message, {
      route: upstreamBody.route,
      pageTitle: upstreamBody.pageTitle,
    });

    // The prompt that Claude receives should contain route context
    expect(prompt).toContain("/flows");
    expect(prompt).toContain("AI Flows");
    expect(prompt).toContain("what is this page?");
    expect(prompt).toBe(
      "[Context: Current route: /flows, Page title: AI Flows]\n\nwhat is this page?",
    );
  });

  it("navigating to a different route produces a different context prefix", () => {
    // First on /flows
    const prompt1 = buildUserMessage("where am I?", {
      route: "/flows",
      pageTitle: "AI Flows",
    });
    expect(prompt1).toContain("/flows");

    // Then on /projects
    const prompt2 = buildUserMessage("where am I?", {
      route: "/projects",
      pageTitle: "Projects",
    });
    expect(prompt2).toContain("/projects");
    expect(prompt2).not.toContain("/flows");
  });
});

describe("buildUserMessage", () => {
  it("returns raw message when no context is provided", () => {
    expect(buildUserMessage("hello")).toBe("hello");
  });

  it("returns raw message when context is undefined", () => {
    expect(buildUserMessage("hello", undefined)).toBe("hello");
  });

  it("returns raw message when context has no route or pageTitle", () => {
    expect(buildUserMessage("hello", {})).toBe("hello");
  });

  it("prepends route context when only route is provided", () => {
    const ctx: RouteContext = { route: "/dashboard/pipelines" };
    const result = buildUserMessage("what is this?", ctx);
    expect(result).toBe(
      "[Context: Current route: /dashboard/pipelines]\n\nwhat is this?",
    );
  });

  it("prepends page title context when only pageTitle is provided", () => {
    const ctx: RouteContext = { pageTitle: "Pipeline Manager" };
    const result = buildUserMessage("help me", ctx);
    expect(result).toBe(
      "[Context: Page title: Pipeline Manager]\n\nhelp me",
    );
  });

  it("prepends both route and pageTitle when both are provided", () => {
    const ctx: RouteContext = {
      route: "/settings/team",
      pageTitle: "Team Settings",
    };
    const result = buildUserMessage("how do I add a member?", ctx);
    expect(result).toBe(
      "[Context: Current route: /settings/team, Page title: Team Settings]\n\nhow do I add a member?",
    );
  });

  it("skips empty-string route", () => {
    const ctx: RouteContext = { route: "", pageTitle: "Dashboard" };
    const result = buildUserMessage("hi", ctx);
    expect(result).toBe("[Context: Page title: Dashboard]\n\nhi");
  });

  it("skips empty-string pageTitle", () => {
    const ctx: RouteContext = { route: "/home", pageTitle: "" };
    const result = buildUserMessage("hi", ctx);
    expect(result).toBe("[Context: Current route: /home]\n\nhi");
  });

  it("returns raw message when both route and pageTitle are empty strings", () => {
    const ctx: RouteContext = { route: "", pageTitle: "" };
    expect(buildUserMessage("hi", ctx)).toBe("hi");
  });
});

describe("KONCIERGE_TOOLS", () => {
  it("defines navigate, highlight, tooltip, and showSection tools", () => {
    const names = KONCIERGE_TOOLS.map((t) => t.name);
    expect(names).toContain("navigate");
    expect(names).toContain("highlight");
    expect(names).toContain("tooltip");
    expect(names).toContain("showSection");
    expect(names).toHaveLength(4);
  });

  it("navigate tool requires 'route' property", () => {
    const nav = KONCIERGE_TOOLS.find((t) => t.name === "navigate")!;
    const schema = nav.input_schema as { required: string[] };
    expect(schema.required).toContain("route");
  });
});

describe("appendAssistantMessage", () => {
  it("appends plain text when no tool_use blocks", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };
    appendAssistantMessage(session, "Hello!");
    expect(session.history).toHaveLength(1);
    expect(session.history[0].role).toBe("assistant");
    expect(session.history[0].content).toBe("Hello!");
  });

  it("appends content array + synthetic tool_result when tool_use blocks present", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };
    const toolBlock: ToolUseBlock = {
      type: "tool_use",
      id: "toolu_123",
      name: "navigate",
      input: { route: "/flows" },
    };
    appendAssistantMessage(session, "Let me take you there.", [toolBlock]);

    // Should have 2 entries: assistant (text+tool_use) and user (tool_result)
    expect(session.history).toHaveLength(2);

    // Assistant message has content array
    const assistant = session.history[0];
    expect(assistant.role).toBe("assistant");
    expect(Array.isArray(assistant.content)).toBe(true);
    const blocks = assistant.content as Array<{ type: string }>;
    expect(blocks[0].type).toBe("text");
    expect(blocks[1].type).toBe("tool_use");

    // Synthetic tool_result
    const user = session.history[1];
    expect(user.role).toBe("user");
    expect(Array.isArray(user.content)).toBe(true);
    const results = user.content as Array<{ type: string; tool_use_id: string }>;
    expect(results[0].type).toBe("tool_result");
    expect(results[0].tool_use_id).toBe("toolu_123");
  });

  it("handles empty text with tool_use blocks (tool-only response)", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };
    const toolBlock: ToolUseBlock = {
      type: "tool_use",
      id: "toolu_456",
      name: "highlight",
      input: { selector: "#btn" },
    };
    appendAssistantMessage(session, "", [toolBlock]);

    // Assistant content should only have tool_use (no empty text block)
    const blocks = session.history[0].content as Array<{ type: string }>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("tool_use");
  });
});
