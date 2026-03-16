import { describe, it, expect } from "bun:test";
import { parseToolCalls } from "./parseToolCalls";

describe("parseToolCalls", () => {
  // ── Navigate tool ─────────────────────────────────────────────

  it("extracts a navigate tool call and strips it from text", () => {
    const raw = 'Let me take you there.\n{"tool":"navigate","route":"/projects"}\nYou should see your projects.';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "navigate",
      route: "/projects",
    });
    expect(result.cleanText).toBe(
      "Let me take you there.\n\nYou should see your projects.",
    );
  });

  // ── Highlight tool ────────────────────────────────────────────

  it("extracts a highlight tool call with message", () => {
    const raw = '{"tool":"highlight","selector":"#sidebar-projects","message":"Click here to see projects"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "highlight",
      selector: "#sidebar-projects",
      message: "Click here to see projects",
    });
    expect(result.cleanText).toBe("");
  });

  it("extracts a highlight tool call without message", () => {
    const raw = '{"tool":"highlight","selector":".create-btn"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "highlight",
      selector: ".create-btn",
      message: undefined,
    });
  });

  // ── Tooltip tool ──────────────────────────────────────────────

  it("extracts a tooltip tool call", () => {
    const raw = 'Here is the button:\n{"tool":"tooltip","selector":".create-btn","message":"Use this to create a new project"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "tooltip",
      selector: ".create-btn",
      message: "Use this to create a new project",
    });
    expect(result.cleanText).toBe("Here is the button:");
  });

  // ── ShowSection tool ──────────────────────────────────────────

  it("extracts a showSection tool call", () => {
    const raw = '{"tool":"showSection","section":"getting-started"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "showSection",
      section: "getting-started",
    });
  });

  // ── Multiple tool calls ───────────────────────────────────────

  it("extracts multiple tool calls in order", () => {
    const raw = [
      "I'll navigate you to the projects page and highlight the create button.",
      '{"tool":"navigate","route":"/projects"}',
      '{"tool":"highlight","selector":".create-btn","message":"Click here"}',
      "That's all!",
    ].join("\n");

    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]).toEqual({
      tool: "navigate",
      route: "/projects",
    });
    expect(result.toolCalls[1]).toEqual({
      tool: "highlight",
      selector: ".create-btn",
      message: "Click here",
    });
    expect(result.cleanText).toBe(
      "I'll navigate you to the projects page and highlight the create button.\n\nThat's all!",
    );
  });

  // ── No tool calls ─────────────────────────────────────────────

  it("returns text unchanged when no tool calls are present", () => {
    const raw = "Just a normal message with no JSON.";
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });

  it("ignores JSON that is not a tool call", () => {
    const raw = 'Here is some config: {"key":"value","setting":true}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });

  // ── Invalid tool calls ────────────────────────────────────────

  it("ignores tool calls with unknown tool names", () => {
    const raw = '{"tool":"destroyEverything","target":"all"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });

  it("ignores navigate tool call missing route", () => {
    const raw = '{"tool":"navigate"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });

  it("ignores tooltip tool call missing message", () => {
    const raw = '{"tool":"tooltip","selector":".btn"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it("handles tool call embedded inline within text", () => {
    const raw = 'Go to {"tool":"navigate","route":"/settings"} and check settings.';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({
      tool: "navigate",
      route: "/settings",
    });
    expect(result.cleanText).toBe("Go to  and check settings.");
  });

  it("handles empty string input", () => {
    const result = parseToolCalls("");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe("");
  });

  it("handles text that is only a tool call", () => {
    const raw = '{"tool":"navigate","route":"/dashboard"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.cleanText).toBe("");
  });

  it("preserves valid JSON that also has a tool field but is not in VALID_TOOLS", () => {
    const raw = '{"tool":"custom","data":"stuff"}';
    const result = parseToolCalls(raw);

    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanText).toBe(raw);
  });
});
