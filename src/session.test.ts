import { describe, it, expect } from "bun:test";
import { buildUserMessage, appendAssistantMessage, KONCIERGE_TOOLS, type RouteContext, type ConversationSession } from "./session";
import type { MessageParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

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

// ─── Multi-turn conversation history validation ───────────────────────────────
// These tests simulate what chatStream + appendAssistantMessage do across
// multiple turns, including the tool_use merge scenario that caused crashes.

/**
 * Simulate what chatStream does: push user message to history.
 * If the last message is a user message with array content (tool_results),
 * merge the new text into it. Otherwise, push a new user message.
 * Returns a rollback function.
 */
function simulateChatStreamPush(
  history: MessageParam[],
  userText: string,
): { rollback: () => void } {
  const historyLenBefore = history.length;
  const lastMsg = history[history.length - 1];
  let originalLastContent: MessageParam["content"] | undefined;

  if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
    originalLastContent = [...lastMsg.content] as MessageParam["content"];
    (lastMsg.content as Array<unknown>).push({ type: "text", text: userText });
  } else {
    history.push({ role: "user", content: userText });
  }

  const rollback = () => {
    if (originalLastContent !== undefined) {
      lastMsg.content = originalLastContent;
    } else {
      history.length = historyLenBefore;
    }
  };

  return { rollback };
}

/**
 * Validate that conversation history alternates user/assistant roles.
 * The Anthropic API requires this.
 */
function validateHistory(history: MessageParam[]): { valid: boolean; error?: string } {
  for (let i = 1; i < history.length; i++) {
    if (history[i].role === history[i - 1].role) {
      return {
        valid: false,
        error: `Consecutive ${history[i].role} messages at indices ${i - 1} and ${i}`,
      };
    }
  }
  return { valid: true };
}

describe("multi-turn conversation history (tool_use scenarios)", () => {
  it("3-turn text-only conversation stays valid", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1
    simulateChatStreamPush(session.history, "Hello");
    appendAssistantMessage(session, "Hi there!");
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 2
    simulateChatStreamPush(session.history, "What is Kapable?");
    appendAssistantMessage(session, "Kapable is a BaaS platform.");
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 3
    simulateChatStreamPush(session.history, "Thanks!");
    appendAssistantMessage(session, "You're welcome!");
    expect(validateHistory(session.history).valid).toBe(true);

    // Should have 6 messages (3 user + 3 assistant)
    expect(session.history).toHaveLength(6);
  });

  it("tool_use response followed by text message stays valid", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: text only
    simulateChatStreamPush(session.history, "Show me the projects page");
    // Claude responds with tool_use (navigate)
    appendAssistantMessage(session, "", [{
      type: "tool_use",
      id: "toolu_001",
      name: "navigate",
      input: { route: "/projects" },
    }]);

    // After tool_use: history = [user, assistant(tool_use), user(tool_result)]
    expect(session.history).toHaveLength(3);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 2: user sends follow-up — this MERGES into the tool_result user message
    simulateChatStreamPush(session.history, "What can I do here?");
    // The last message should still be user (with tool_result + text merged)
    expect(session.history).toHaveLength(3); // NOT 4
    const lastUser = session.history[2];
    expect(lastUser.role).toBe("user");
    expect(Array.isArray(lastUser.content)).toBe(true);
    const blocks = lastUser.content as Array<{ type: string }>;
    expect(blocks).toHaveLength(2); // tool_result + text
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[1].type).toBe("text");

    // History is still valid (alternating roles)
    expect(validateHistory(session.history).valid).toBe(true);

    // Claude responds with text
    appendAssistantMessage(session, "Here you can manage your projects.");
    expect(session.history).toHaveLength(4);
    expect(validateHistory(session.history).valid).toBe(true);
  });

  it("two consecutive tool_use turns stay valid", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: user asks, Claude navigates
    simulateChatStreamPush(session.history, "Show me flows");
    appendAssistantMessage(session, "", [{
      type: "tool_use",
      id: "toolu_A",
      name: "navigate",
      input: { route: "/flows" },
    }]);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 2: user asks again, Claude highlights something
    simulateChatStreamPush(session.history, "Where is the create button?");
    appendAssistantMessage(session, "Here it is!", [{
      type: "tool_use",
      id: "toolu_B",
      name: "highlight",
      input: { selector: "#create-flow-btn" },
    }]);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 3: user asks text question
    simulateChatStreamPush(session.history, "What does it do?");
    appendAssistantMessage(session, "It creates a new AI flow.");
    expect(validateHistory(session.history).valid).toBe(true);

    // Verify no duplicate tool_use IDs in the full history
    const historyStr = JSON.stringify(session.history);
    const toolACount = (historyStr.match(/toolu_A/g) || []).length;
    const toolBCount = (historyStr.match(/toolu_B/g) || []).length;
    // Each tool_use ID appears exactly twice: once in assistant (tool_use) and once in user (tool_result)
    expect(toolACount).toBe(2);
    expect(toolBCount).toBe(2);
  });

  it("rollback after error preserves valid history for next turn", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: successful
    simulateChatStreamPush(session.history, "Hello");
    appendAssistantMessage(session, "Hi!");
    expect(session.history).toHaveLength(2);

    // Turn 2: API error — rollback the user message
    const { rollback } = simulateChatStreamPush(session.history, "This will fail");
    expect(session.history).toHaveLength(3); // user message was pushed
    rollback();
    expect(session.history).toHaveLength(2); // rolled back to 2

    // History is still valid
    expect(validateHistory(session.history).valid).toBe(true);
    expect(session.history[1].role).toBe("assistant");

    // Turn 3: retry succeeds
    simulateChatStreamPush(session.history, "Try again");
    appendAssistantMessage(session, "Success!");
    expect(session.history).toHaveLength(4);
    expect(validateHistory(session.history).valid).toBe(true);
  });

  it("rollback after error when last message was tool_result", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: tool_use response
    simulateChatStreamPush(session.history, "Navigate to projects");
    appendAssistantMessage(session, "", [{
      type: "tool_use",
      id: "toolu_X",
      name: "navigate",
      input: { route: "/projects" },
    }]);
    expect(session.history).toHaveLength(3);

    // The last message is a user message with tool_result
    const toolResultMsg = session.history[2];
    expect(toolResultMsg.role).toBe("user");
    const originalContent = JSON.parse(JSON.stringify(toolResultMsg.content));

    // Turn 2: API error after merge — rollback must restore the tool_result message
    const { rollback } = simulateChatStreamPush(session.history, "What can I see?");

    // After push, the tool_result message was mutated to include text
    const mutatedContent = toolResultMsg.content as Array<{ type: string }>;
    expect(mutatedContent).toHaveLength(2); // tool_result + text

    // Rollback
    rollback();

    // The tool_result message should be restored to its original state
    const restoredContent = toolResultMsg.content as Array<{ type: string }>;
    expect(restoredContent).toHaveLength(1); // just tool_result
    expect(restoredContent[0].type).toBe("tool_result");
    expect(JSON.stringify(toolResultMsg.content)).toBe(JSON.stringify(originalContent));

    // History is still valid
    expect(session.history).toHaveLength(3);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 3: retry succeeds
    simulateChatStreamPush(session.history, "What can I see?");
    appendAssistantMessage(session, "You can see your projects.");
    expect(session.history).toHaveLength(4);
    expect(validateHistory(session.history).valid).toBe(true);
  });

  it("multiple consecutive errors with rollback keep history clean", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: successful
    simulateChatStreamPush(session.history, "Hello");
    appendAssistantMessage(session, "Hi!");

    // 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      const { rollback } = simulateChatStreamPush(session.history, `Fail ${i}`);
      rollback();
    }

    // History should still be exactly 2 messages
    expect(session.history).toHaveLength(2);
    expect(validateHistory(session.history).valid).toBe(true);

    // Successful turn after failures
    simulateChatStreamPush(session.history, "Finally works");
    appendAssistantMessage(session, "Glad it works!");
    expect(session.history).toHaveLength(4);
    expect(validateHistory(session.history).valid).toBe(true);
  });

  it("5-turn mixed conversation (text + tool_use) stays valid throughout", () => {
    const session: ConversationSession = { history: [], createdAt: Date.now() };

    // Turn 1: text response
    simulateChatStreamPush(session.history, "What is Kapable?");
    appendAssistantMessage(session, "Kapable is a BaaS platform.");
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 2: tool_use response (navigate)
    simulateChatStreamPush(session.history, "Show me the dashboard");
    appendAssistantMessage(session, "", [{
      type: "tool_use",
      id: "toolu_nav1",
      name: "navigate",
      input: { route: "/dashboard" },
    }]);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 3: text response (merged into tool_result user message)
    simulateChatStreamPush(session.history, "What am I looking at?");
    appendAssistantMessage(session, "This is your organization dashboard.");
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 4: another tool_use (highlight)
    simulateChatStreamPush(session.history, "Where are my projects?");
    appendAssistantMessage(session, "Right here!", [{
      type: "tool_use",
      id: "toolu_hl1",
      name: "highlight",
      input: { selector: "#projects-section" },
    }]);
    expect(validateHistory(session.history).valid).toBe(true);

    // Turn 5: final text response (merged into tool_result)
    simulateChatStreamPush(session.history, "Thanks!");
    appendAssistantMessage(session, "Happy to help!");
    expect(validateHistory(session.history).valid).toBe(true);

    // Verify all roles alternate
    for (let i = 1; i < session.history.length; i++) {
      expect(session.history[i].role).not.toBe(session.history[i - 1].role);
    }
  });
});
