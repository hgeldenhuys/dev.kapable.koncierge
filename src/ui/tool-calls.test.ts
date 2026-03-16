import { describe, it, expect } from "bun:test";
import { parseToolCalls } from "./tool-calls";

describe("parseToolCalls", () => {
  it("returns unchanged text when no tool calls present", () => {
    const text = "Hello! Let me help you get started with Kapable.";
    const result = parseToolCalls(text);
    expect(result.displayText).toBe(text);
    expect(result.toolCalls).toEqual([]);
  });

  it("extracts a fenced navigate tool call", () => {
    const text = [
      "Let me take you there!",
      '```tool',
      '{"tool":"navigate","args":{"route":"/flows"}}',
      '```',
      "You should now see the flows page.",
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("navigate");
    expect((result.toolCalls[0] as { args: { route: string } }).args.route).toBe("/flows");
    expect(result.displayText).not.toContain("navigate");
    expect(result.displayText).toContain("Let me take you there!");
    expect(result.displayText).toContain("You should now see the flows page.");
  });

  it("extracts a fenced json block with a tool call", () => {
    const text = [
      "Here it is:",
      '```json',
      '{"tool":"highlight","args":{"selector":"#create-btn","durationMs":5000}}',
      '```',
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("highlight");
    expect((result.toolCalls[0] as { args: { selector: string } }).args.selector).toBe("#create-btn");
  });

  it("extracts a bare tool call on its own line", () => {
    const text = [
      "I'll highlight that for you.",
      '{"tool":"highlight","args":{"selector":".nav-item"}}',
      "Done!",
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("highlight");
    expect(result.displayText).toContain("I'll highlight that for you.");
    expect(result.displayText).toContain("Done!");
    expect(result.displayText).not.toContain('"tool"');
  });

  it("extracts multiple tool calls from one message", () => {
    const text = [
      "Let me navigate and highlight.",
      '```tool',
      '{"tool":"navigate","args":{"route":"/flows"}}',
      '```',
      '```tool',
      '{"tool":"highlight","args":{"selector":"#create-flow-btn"}}',
      '```',
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].tool).toBe("navigate");
    expect(result.toolCalls[1].tool).toBe("highlight");
  });

  it("extracts tooltip tool call", () => {
    const text = '{"tool":"tooltip","args":{"selector":".help-icon","text":"Click here for help"}}';
    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("tooltip");
    const args = (result.toolCalls[0] as { args: { text: string } }).args;
    expect(args.text).toBe("Click here for help");
  });

  it("extracts showSection tool call", () => {
    const text = '{"tool":"showSection","args":{"selector":"#metrics-panel"}}';
    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("showSection");
  });

  it("ignores invalid tool names", () => {
    const text = '{"tool":"deleteAll","args":{"target":"everything"}}';
    const result = parseToolCalls(text);
    expect(result.toolCalls).toEqual([]);
    expect(result.displayText).toBe(text);
  });

  it("ignores malformed JSON in fenced blocks", () => {
    const text = [
      "Check this out:",
      '```tool',
      '{this is not valid json}',
      '```',
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toEqual([]);
    // The malformed block should remain in the text
    expect(result.displayText).toContain("this is not valid json");
  });

  it("preserves non-tool fenced code blocks", () => {
    const text = [
      "Here's some code:",
      '```typescript',
      'const x = { tool: "navigate" };',
      '```',
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toEqual([]);
    expect(result.displayText).toContain("const x");
  });

  it("collapses excessive blank lines after stripping", () => {
    const text = [
      "Before",
      "",
      '```tool',
      '{"tool":"navigate","args":{"route":"/"}}',
      '```',
      "",
      "",
      "",
      "After",
    ].join("\n");

    const result = parseToolCalls(text);
    expect(result.toolCalls).toHaveLength(1);
    // Should not have 3+ consecutive newlines
    expect(result.displayText).not.toMatch(/\n{3,}/);
    expect(result.displayText).toContain("Before");
    expect(result.displayText).toContain("After");
  });
});
