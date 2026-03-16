/**
 * Koncierge tool call types and parser.
 *
 * The agent embeds structured tool calls in its response text as JSON blocks.
 * Format: ```tool\n{"tool":"navigate","args":{"route":"/flows"}}\n```
 *
 * This module extracts those blocks, returning clean display text + parsed
 * tool payloads for execution by useKonciergeTools().
 */

// ─── Tool call types ──────────────────────────────────────────────────────────

export interface NavigateToolCall {
  tool: "navigate";
  args: { route: string };
}

export interface HighlightToolCall {
  tool: "highlight";
  args: { selector: string; durationMs?: number };
}

export interface TooltipToolCall {
  tool: "tooltip";
  args: { selector: string; text: string; durationMs?: number };
}

export interface ShowSectionToolCall {
  tool: "showSection";
  args: { selector: string };
}

export type KonciergeToolCall =
  | NavigateToolCall
  | HighlightToolCall
  | TooltipToolCall
  | ShowSectionToolCall;

const VALID_TOOLS = new Set(["navigate", "highlight", "tooltip", "showSection"]);

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Result of parsing a message for tool calls.
 */
export interface ParsedMessage {
  /** Message text with tool JSON blocks removed */
  displayText: string;
  /** Extracted tool calls in order of appearance */
  toolCalls: KonciergeToolCall[];
}

/**
 * Matches fenced tool blocks: ```tool\n{...}\n``` or ```json\n{...}\n```
 * Also matches bare JSON objects with a "tool" key on their own line.
 */
const FENCED_BLOCK_RE = /```(?:tool|json)\s*\n(\{[\s\S]*?\})\s*\n```/g;
const BARE_TOOL_RE = /^(\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\})$/gm;

function tryParseToolCall(json: string): KonciergeToolCall | null {
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.tool === "string" &&
      VALID_TOOLS.has(parsed.tool) &&
      parsed.args &&
      typeof parsed.args === "object"
    ) {
      return parsed as KonciergeToolCall;
    }
  } catch {
    // Not valid JSON — skip
  }
  return null;
}

/**
 * Parse assistant message text, extracting embedded tool call JSON blocks.
 *
 * Supports two formats:
 * 1. Fenced: ```tool\n{"tool":"navigate","args":{...}}\n```
 * 2. Bare: {"tool":"navigate","args":{...}} on its own line
 *
 * Returns clean display text (tool blocks removed, excess whitespace trimmed)
 * and an array of parsed tool calls.
 */
export function parseToolCalls(text: string): ParsedMessage {
  const toolCalls: KonciergeToolCall[] = [];
  let cleaned = text;

  // Pass 1: fenced blocks
  cleaned = cleaned.replace(FENCED_BLOCK_RE, (_match, json: string) => {
    const tc = tryParseToolCall(json.trim());
    if (tc) {
      toolCalls.push(tc);
      return "";
    }
    return _match; // Not a valid tool call — leave the block
  });

  // Pass 2: bare tool JSON lines
  cleaned = cleaned.replace(BARE_TOOL_RE, (match) => {
    const tc = tryParseToolCall(match.trim());
    if (tc) {
      toolCalls.push(tc);
      return "";
    }
    return match;
  });

  // Collapse excessive blank lines left by removal
  const displayText = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return { displayText, toolCalls };
}
