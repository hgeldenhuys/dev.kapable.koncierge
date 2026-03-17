import type { Subprocess } from "bun";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RouteContext {
  route?: string;
  pageTitle?: string;
}

/** Shared resources loaded at startup */
export interface KonciergeCore {
  /** Agent persona/tool instructions (short, passed via --append-system-prompt) */
  agentDef: string;
  knowledgeBaseChars: number;
}

/** Result from chatStream — the CC subprocess and its stdout pipe */
export interface ChatStreamResult {
  stdout: ReadableStream<Uint8Array>;
  process: Subprocess;
}

/** A tool call parsed from the assistant's text output */
export interface ParsedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ─── Active session tracking (for /health + resume logic) ────────────────────

/**
 * Tracks which session UUIDs have been created via --session-id.
 * On first message: --session-id creates the CC session.
 * On subsequent messages: --resume continues it.
 */
const createdSessions = new Set<string>();

export function trackSession(token: string): void {
  createdSessions.add(token);
}

export function isSessionCreated(sessionId: string): boolean {
  return createdSessions.has(sessionId);
}

export function getSessionCount(): number {
  return createdSessions.size;
}

// ─── Build user message ──────────────────────────────────────────────────────

/**
 * Build the full user message with optional route context prefix.
 */
export function buildUserMessage(message: string, ctx?: RouteContext): string {
  if (!ctx) return message;
  const parts: string[] = [];
  if (ctx.route) parts.push(`Current route: ${ctx.route}`);
  if (ctx.pageTitle) parts.push(`Page title: ${ctx.pageTitle}`);
  if (parts.length === 0) return message;
  return `[Context: ${parts.join(", ")}]\n\n${message}`;
}

// ─── Session creation (load knowledge base + agent def) ──────────────────────

/**
 * Load knowledge base and agent instructions from disk.
 * Combines them into a single system prompt string.
 */
export async function createSession(): Promise<KonciergeCore> {
  const root = import.meta.dir + "/..";

  const knowledgeBase = await Bun.file(`${root}/knowledge/KAPABLE_KNOWLEDGE_BASE.md`).text();
  const agentDef = await Bun.file(`${root}/agents/koncierge-cc.md`).text();

  console.log(`Knowledge base loaded: ${knowledgeBase.length} chars`);
  console.log(`Agent instructions loaded: ${agentDef.length} chars`);

  // Write knowledge base to CLAUDE.md so CC loads it as project context.
  // This avoids E2BIG on Linux — the 131K+ knowledge base cannot be passed
  // as a CLI arg (posix_spawn limit). CC auto-loads CLAUDE.md from CWD.
  // The short agent def (3.3K) goes via --append-system-prompt.
  const claudeMdPath = `${root}/CLAUDE.md`;
  await Bun.write(claudeMdPath, knowledgeBase);
  console.log(`Knowledge base written to CLAUDE.md (${knowledgeBase.length} chars)`);

  return {
    agentDef,
    knowledgeBaseChars: knowledgeBase.length,
  };
}

// ─── Token → UUID conversion ─────────────────────────────────────────────────

/**
 * Convert a session token (arbitrary string) to a deterministic UUID.
 * CC --session-id requires a valid UUID. We hash the token with SHA-256
 * and format the first 16 bytes as a v4-format UUID.
 */
export function tokenToSessionId(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  const hex = hasher.digest("hex");
  // Format as UUID v4: xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ─── Chat stream (CC subprocess) ─────────────────────────────────────────────

/**
 * Spawn a Claude Code subprocess for streaming chat.
 *
 * First message for a token: --session-id creates the CC session.
 * Subsequent messages: --resume continues the conversation.
 * CC manages the full conversation history internally.
 */
export function chatStream(
  core: KonciergeCore,
  sessionToken: string,
  userMessage: string,
  routeContext?: RouteContext,
): ChatStreamResult {
  const fullMessage = buildUserMessage(userMessage, routeContext);
  const sessionId = tokenToSessionId(sessionToken);
  const isResume = isSessionCreated(sessionId);

  const args = [
    "claude",
    "-p", fullMessage,
    "--output-format", "stream-json",
    "--verbose",
    "--model", "sonnet",
    // Agent def is small (~3K) — safe as CLI arg. Knowledge base is in
    // CLAUDE.md at CWD, loaded automatically by CC as project context.
    "--append-system-prompt", core.agentDef,
    "--dangerously-skip-permissions",
    "--max-turns", "1",
    // Performance: disable all tools (Koncierge is conversational only)
    "--tools", "",
    // Performance: no Chrome MCP needed
    "--no-chrome",
  ];

  if (isResume) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", sessionId);
  }

  const proc = Bun.spawn(args, {
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Track after spawn — marks this session as created for future --resume
  trackSession(sessionId);

  return { stdout: proc.stdout, process: proc };
}

// ─── Tool call parsing ───────────────────────────────────────────────────────

let globalToolCallId = 0;

/**
 * Check if a line of text is a tool call JSON block.
 * Tool calls look like: {"tool": "navigate", "route": "/projects"}
 */
function isToolCallJson(line: string): boolean {
  const trimmed = line.trim();
  return (trimmed.startsWith('{"tool"') || trimmed.startsWith('{ "tool"')) && trimmed.endsWith('}');
}

/**
 * Parse a JSON tool call line into a structured tool call.
 * Returns null if parsing fails or the line isn't a tool call.
 */
export function parseToolCallLine(line: string): ParsedToolCall | null {
  const trimmed = line.trim();
  if (!isToolCallJson(trimmed)) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed.tool || typeof parsed.tool !== "string") return null;

    const name = parsed.tool;
    const input: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "tool") {
        input[key] = value;
      }
    }

    return {
      id: `toolu_cc_${globalToolCallId++}`,
      name,
      input,
    };
  } catch {
    return null;
  }
}

/**
 * Process accumulated text to extract tool calls and clean text.
 * Returns the text with tool call JSON lines removed, plus parsed tool calls.
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ParsedToolCall[];
} {
  const lines = text.split("\n");
  const cleanLines: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  for (const line of lines) {
    const toolCall = parseToolCallLine(line);
    if (toolCall) {
      toolCalls.push(toolCall);
    } else {
      cleanLines.push(line);
    }
  }

  return {
    cleanText: cleanLines.join("\n"),
    toolCalls,
  };
}
