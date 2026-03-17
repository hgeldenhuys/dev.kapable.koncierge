import { describe, it, expect } from "bun:test";
import {
  buildUserMessage,
  extractToolCalls,
  parseToolCallLine,
  getSessionCount,
  trackSession,
  tokenToSessionId,
  type RouteContext,
} from "./session";

// ─── buildUserMessage ────────────────────────────────────────────────────────

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

// ─── Route context smoke test ────────────────────────────────────────────────

describe("smoke test — route context reaches Claude prompt", () => {
  it("buildUserMessage produces context-prefixed prompt for /flows", () => {
    const prompt = buildUserMessage("what is this page?", {
      route: "/flows",
      pageTitle: "AI Flows",
    });
    expect(prompt).toContain("/flows");
    expect(prompt).toContain("AI Flows");
    expect(prompt).toContain("what is this page?");
    expect(prompt).toBe(
      "[Context: Current route: /flows, Page title: AI Flows]\n\nwhat is this page?",
    );
  });

  it("navigating to a different route produces a different context prefix", () => {
    const prompt1 = buildUserMessage("where am I?", {
      route: "/flows",
      pageTitle: "AI Flows",
    });
    expect(prompt1).toContain("/flows");

    const prompt2 = buildUserMessage("where am I?", {
      route: "/projects",
      pageTitle: "Projects",
    });
    expect(prompt2).toContain("/projects");
    expect(prompt2).not.toContain("/flows");
  });
});

// ─── parseToolCallLine ───────────────────────────────────────────────────────

describe("parseToolCallLine", () => {
  it("parses a navigate tool call", () => {
    const result = parseToolCallLine('{"tool": "navigate", "route": "/projects"}');
    expect(result).not.toBeNull();
    expect(result!.name).toBe("navigate");
    expect(result!.input).toEqual({ route: "/projects" });
    expect(result!.id).toMatch(/^toolu_cc_/);
  });

  it("parses a highlight tool call with durationMs", () => {
    const result = parseToolCallLine('{"tool": "highlight", "selector": "#btn", "durationMs": 3000}');
    expect(result).not.toBeNull();
    expect(result!.name).toBe("highlight");
    expect(result!.input).toEqual({ selector: "#btn", durationMs: 3000 });
  });

  it("parses a tooltip tool call", () => {
    const result = parseToolCallLine('{"tool": "tooltip", "selector": "#el", "text": "Help text"}');
    expect(result).not.toBeNull();
    expect(result!.name).toBe("tooltip");
    expect(result!.input).toEqual({ selector: "#el", text: "Help text" });
  });

  it("returns null for non-tool JSON", () => {
    expect(parseToolCallLine('{"type": "text", "text": "hello"}')).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseToolCallLine("Hello world")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseToolCallLine('{"tool": "navigate", broken}')).toBeNull();
  });

  it("returns null for empty line", () => {
    expect(parseToolCallLine("")).toBeNull();
  });

  it("handles tool call with extra whitespace", () => {
    const result = parseToolCallLine('  {"tool": "navigate", "route": "/flows"}  ');
    expect(result).not.toBeNull();
    expect(result!.name).toBe("navigate");
  });
});

// ─── extractToolCalls ────────────────────────────────────────────────────────

describe("extractToolCalls", () => {
  it("extracts tool calls and removes them from text", () => {
    const text = `Let me take you to the Flows page.
{"tool": "navigate", "route": "/flows"}
Here you can see all your AI flows.`;

    const result = extractToolCalls(text);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("navigate");
    expect(result.toolCalls[0].input).toEqual({ route: "/flows" });

    expect(result.cleanText).toContain("Let me take you to the Flows page.");
    expect(result.cleanText).toContain("Here you can see all your AI flows.");
    expect(result.cleanText).not.toContain('"tool"');
  });

  it("handles text with no tool calls", () => {
    const text = "Hello! How can I help you today?";
    const result = extractToolCalls(text);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(text);
  });

  it("handles multiple tool calls", () => {
    const text = `Let me show you around.
{"tool": "navigate", "route": "/dashboard"}
And here is the sidebar.
{"tool": "highlight", "selector": "#sidebar"}`;

    const result = extractToolCalls(text);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("navigate");
    expect(result.toolCalls[1].name).toBe("highlight");
    expect(result.cleanText).not.toContain('"tool"');
  });

  it("handles empty text", () => {
    const result = extractToolCalls("");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe("");
  });
});

// ─── tokenToSessionId ────────────────────────────────────────────────────────

describe("tokenToSessionId", () => {
  it("produces a valid UUID format", () => {
    const uuid = tokenToSessionId("test-token-123");
    // UUID format: 8-4-4-4-12 hex chars
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is deterministic — same token always produces same UUID", () => {
    const uuid1 = tokenToSessionId("my-session-token");
    const uuid2 = tokenToSessionId("my-session-token");
    expect(uuid1).toBe(uuid2);
  });

  it("different tokens produce different UUIDs", () => {
    const uuid1 = tokenToSessionId("alice-token");
    const uuid2 = tokenToSessionId("bob-token");
    expect(uuid1).not.toBe(uuid2);
  });

  it("handles long HMAC-derived tokens", () => {
    const longToken = "a".repeat(64);
    const uuid = tokenToSessionId(longToken);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

// ─── Session tracking ────────────────────────────────────────────────────────

describe("session tracking", () => {
  it("trackSession increases session count", () => {
    const before = getSessionCount();
    trackSession(`test-track-${Date.now()}`);
    expect(getSessionCount()).toBe(before + 1);
  });

  it("same token does not increase count", () => {
    const token = `test-dedup-${Date.now()}`;
    trackSession(token);
    const after1 = getSessionCount();
    trackSession(token);
    expect(getSessionCount()).toBe(after1);
  });
});
