import { describe, it, expect, mock, beforeEach } from "bun:test";
import React from "react";

// ── Unit tests for tool call extraction and SSE parsing ──────

// Re-implement the extraction logic here for isolated testing
// (same as in KonciergePanel.tsx and koncierge-adapter.ts)
const TOOL_CALL_RE = /\{"tool"\s*:\s*"(\w+)"[^}]*\}/g;

function extractToolCalls(text: string) {
  const calls: Array<{ tool: string; [key: string]: unknown }> = [];
  const matches = text.matchAll(TOOL_CALL_RE);
  for (const match of matches) {
    try {
      calls.push(JSON.parse(match[0]));
    } catch {
      // skip
    }
  }
  return calls;
}

function stripToolCallJson(text: string): string {
  return text
    .replace(TOOL_CALL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── SSE line parser (simulating ReadableStream parsing) ──────

function parseSSELines(raw: string): Array<{ delta?: string; error?: string }> {
  const events: Array<{ delta?: string; error?: string }> = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      // skip malformed
    }
  }

  return events;
}

// ── Tests ────────────────────────────────────────────────────

describe("Tool call extraction", () => {
  it("extracts a navigate tool call from text", () => {
    const text = 'Let me take you there. {"tool": "navigate", "route": "/projects"}';
    const calls = extractToolCalls(text);

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("navigate");
    expect(calls[0].route).toBe("/projects");
  });

  it("extracts multiple tool calls", () => {
    const text =
      'First, look here: {"tool": "highlight", "selector": "#sidebar", "message": "Click here"} ' +
      'Then go here: {"tool": "navigate", "route": "/apps"}';
    const calls = extractToolCalls(text);

    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe("highlight");
    expect(calls[0].selector).toBe("#sidebar");
    expect(calls[1].tool).toBe("navigate");
    expect(calls[1].route).toBe("/apps");
  });

  it("returns empty array for text without tool calls", () => {
    const text = "Just a normal response about the platform.";
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it("skips malformed JSON", () => {
    const text = 'Here is a broken one: {"tool": "navigate", "route": }';
    const calls = extractToolCalls(text);
    expect(calls).toHaveLength(0);
  });

  it("extracts tooltip tool calls", () => {
    const text = '{"tool": "tooltip", "target": ".deploy-btn", "text": "Deploy here"}';
    const calls = extractToolCalls(text);

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("tooltip");
    expect(calls[0].target).toBe(".deploy-btn");
    expect(calls[0].text).toBe("Deploy here");
  });

  it("extracts showSection tool calls", () => {
    const text = '{"tool": "showSection", "id": "environment-variables"}';
    const calls = extractToolCalls(text);

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("showSection");
    expect(calls[0].id).toBe("environment-variables");
  });
});

describe("Strip tool call JSON from text", () => {
  it("removes tool call JSON and trims", () => {
    const text = 'Let me take you there. {"tool": "navigate", "route": "/projects"}';
    const clean = stripToolCallJson(text);
    expect(clean).toBe("Let me take you there.");
  });

  it("removes multiple tool calls", () => {
    const text =
      'First: {"tool": "highlight", "selector": "#a", "message": "x"} ' +
      'Then: {"tool": "navigate", "route": "/b"}';
    const clean = stripToolCallJson(text);
    expect(clean).toBe("First:  Then:");
  });

  it("leaves text untouched when no tool calls", () => {
    const text = "No tool calls here.";
    const clean = stripToolCallJson(text);
    expect(clean).toBe("No tool calls here.");
  });

  it("collapses excessive newlines after removal", () => {
    const text =
      'Before\n\n\n{"tool": "navigate", "route": "/x"}\n\n\nAfter';
    const clean = stripToolCallJson(text);
    expect(clean).toBe("Before\n\nAfter");
  });
});

describe("SSE line parsing", () => {
  it("parses delta events", () => {
    const raw = 'data: {"delta": "Hello "}\ndata: {"delta": "world"}\n';
    const events = parseSSELines(raw);

    expect(events).toHaveLength(2);
    expect(events[0].delta).toBe("Hello ");
    expect(events[1].delta).toBe("world");
  });

  it("skips [DONE] marker", () => {
    const raw = 'data: {"delta": "test"}\ndata: [DONE]\n';
    const events = parseSSELines(raw);

    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe("test");
  });

  it("handles error events", () => {
    const raw = 'data: {"error": "Rate limited"}\ndata: [DONE]\n';
    const events = parseSSELines(raw);

    expect(events).toHaveLength(1);
    expect(events[0].error).toBe("Rate limited");
  });

  it("skips non-data lines", () => {
    const raw = 'event: message\ndata: {"delta": "ok"}\nid: 1\n\n';
    const events = parseSSELines(raw);

    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe("ok");
  });

  it("skips malformed JSON lines", () => {
    const raw = 'data: not json\ndata: {"delta": "good"}\n';
    const events = parseSSELines(raw);

    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe("good");
  });
});

describe("Full SSE → message pipeline", () => {
  it("accumulates deltas and extracts tool calls", () => {
    const chunks = [
      'data: {"delta": "Let me show you. "}\n',
      'data: {"delta": "{\\"tool\\": \\"navigate\\", "}\n',
      'data: {"delta": "\\"route\\": \\"/projects\\"}"}\n',
      "data: [DONE]\n",
    ];

    let fullText = "";
    for (const chunk of chunks) {
      const events = parseSSELines(chunk);
      for (const event of events) {
        if (event.delta) fullText += event.delta;
      }
    }

    expect(fullText).toContain("Let me show you.");
    expect(fullText).toContain('"tool": "navigate"');

    const toolCalls = extractToolCalls(fullText);
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].tool).toBe("navigate");
    expect(toolCalls[0].route).toBe("/projects");

    const cleanText = stripToolCallJson(fullText);
    expect(cleanText).toBe("Let me show you.");
  });
});

describe("Component exports", () => {
  it("exports KonciergePanel", async () => {
    const mod = await import("./KonciergePanel");
    expect(mod.KonciergePanel).toBeDefined();
    expect(typeof mod.KonciergePanel).toBe("function");
  });

  it("exports useKonciergeStream", async () => {
    const mod = await import("./KonciergePanel");
    expect(mod.useKonciergeStream).toBeDefined();
    expect(typeof mod.useKonciergeStream).toBe("function");
  });

  it("exports KonciergeToggle", async () => {
    const mod = await import("./KonciergeToggle");
    expect(mod.KonciergeToggle).toBeDefined();
    expect(typeof mod.KonciergeToggle).toBe("function");
  });

  it("exports KonciergeSidebar", async () => {
    const mod = await import("./KonciergeSidebar");
    expect(mod.KonciergeSidebar).toBeDefined();
    expect(typeof mod.KonciergeSidebar).toBe("function");
  });

  it("exports createKonciergeAdapter", async () => {
    const mod = await import("./koncierge-adapter");
    expect(mod.createKonciergeAdapter).toBeDefined();
    expect(typeof mod.createKonciergeAdapter).toBe("function");
  });

  it("barrel exports all components from index", async () => {
    const mod = await import("./index");
    expect(mod.KonciergePanel).toBeDefined();
    expect(mod.KonciergeToggle).toBeDefined();
    expect(mod.KonciergeSidebar).toBeDefined();
    expect(mod.useKonciergeStream).toBeDefined();
    expect(mod.createKonciergeAdapter).toBeDefined();
  });
});

describe("createKonciergeAdapter", () => {
  it("creates an adapter with a run method", () => {
    const { createKonciergeAdapter } = require("./koncierge-adapter");
    const adapter = createKonciergeAdapter({
      endpoint: "/bff/koncierge/message",
    });

    expect(adapter).toBeDefined();
    expect(typeof adapter.run).toBe("function");
  });
});
