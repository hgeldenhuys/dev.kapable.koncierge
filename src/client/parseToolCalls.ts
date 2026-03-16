/**
 * Parse and extract tool call JSON objects from agent response text.
 *
 * The Koncierge agent emits JSON tool calls inline within its natural
 * language responses. For example:
 *
 *   Here are your projects:
 *   {"tool":"navigate","route":"/projects"}
 *   Click the button below to create a new one.
 *
 * This module detects those JSON blocks, strips them from the visible
 * text, and returns structured ToolCall objects for execution.
 */

// ── Tool call types ──────────────────────────────────────────────

export interface NavigateToolCall {
  tool: "navigate";
  route: string;
}

export interface HighlightToolCall {
  tool: "highlight";
  selector: string;
  message?: string;
}

export interface TooltipToolCall {
  tool: "tooltip";
  selector: string;
  message: string;
}

export interface ShowSectionToolCall {
  tool: "showSection";
  section: string;
}

export type ToolCall =
  | NavigateToolCall
  | HighlightToolCall
  | TooltipToolCall
  | ShowSectionToolCall;

const VALID_TOOLS = new Set(["navigate", "highlight", "tooltip", "showSection"]);

export interface ParseResult {
  /** Text with tool call JSON stripped out */
  cleanText: string;
  /** Extracted tool calls in order of appearance */
  toolCalls: ToolCall[];
}

/**
 * Regex to match JSON objects that look like tool calls.
 *
 * Matches `{ ... }` blocks that contain `"tool"` somewhere inside.
 * Uses a non-greedy match between braces — this works because tool
 * call JSON is always a flat object (no nested braces).
 */
const TOOL_CALL_RE = /\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}/g;

/**
 * Parse raw agent text and extract any tool call JSON objects.
 *
 * Returns the cleaned text (tool calls removed, surrounding
 * whitespace collapsed) and an array of parsed ToolCall objects.
 */
export function parseToolCalls(rawText: string): ParseResult {
  const toolCalls: ToolCall[] = [];

  const cleanText = rawText.replace(TOOL_CALL_RE, (match) => {
    try {
      const parsed = JSON.parse(match);
      if (parsed && typeof parsed.tool === "string" && VALID_TOOLS.has(parsed.tool)) {
        const toolCall = validateToolCall(parsed);
        if (toolCall) {
          toolCalls.push(toolCall);
          return ""; // strip from visible text
        }
      }
    } catch {
      // Not valid JSON — leave it in the text
    }
    return match;
  });

  return {
    cleanText: collapseWhitespace(cleanText),
    toolCalls,
  };
}

/**
 * Validate and type-narrow a parsed JSON object into a ToolCall.
 * Returns null if required fields are missing.
 */
function validateToolCall(obj: Record<string, unknown>): ToolCall | null {
  switch (obj.tool) {
    case "navigate":
      if (typeof obj.route === "string") {
        return { tool: "navigate", route: obj.route };
      }
      return null;

    case "highlight":
      if (typeof obj.selector === "string") {
        return {
          tool: "highlight",
          selector: obj.selector,
          message: typeof obj.message === "string" ? obj.message : undefined,
        };
      }
      return null;

    case "tooltip":
      if (typeof obj.selector === "string" && typeof obj.message === "string") {
        return { tool: "tooltip", selector: obj.selector, message: obj.message };
      }
      return null;

    case "showSection":
      if (typeof obj.section === "string") {
        return { tool: "showSection", section: obj.section };
      }
      return null;

    default:
      return null;
  }
}

/**
 * Collapse runs of blank lines (from stripped tool calls) into
 * a single newline, and trim leading/trailing whitespace.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n") // collapse 3+ newlines → 2
    .replace(/^\s*\n/, "")       // trim leading blank line
    .replace(/\n\s*$/, "")       // trim trailing blank line
    .trim();
}
