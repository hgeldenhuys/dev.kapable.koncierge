import Anthropic from "@anthropic-ai/sdk";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import type { MessageParam, Tool, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

const MODEL = process.env.OPENROUTER_API_KEY
  ? "anthropic/claude-sonnet-4"
  : "claude-sonnet-4-20250514";

// ─── Koncierge tool definitions for the Claude API ──────────────────────────

export const KONCIERGE_TOOLS: Tool[] = [
  {
    name: "navigate",
    description:
      "Navigate the user to a specific page in the Kapable console. Use this when the user asks to go somewhere or you want to guide them to a feature.",
    input_schema: {
      type: "object" as const,
      properties: {
        route: {
          type: "string",
          description: "The route path to navigate to, e.g. /projects, /flows, /dashboard",
        },
      },
      required: ["route"],
    },
  },
  {
    name: "highlight",
    description:
      "Draw attention to a UI element by highlighting it with a pulsing outline and scrolling it into view.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element to highlight, e.g. #sidebar-projects",
        },
        durationMs: {
          type: "number",
          description: "How long to keep the highlight visible in milliseconds. Default: 3000",
        },
      },
      required: ["selector"],
    },
  },
  {
    name: "tooltip",
    description:
      "Show a contextual tooltip near a UI element to explain what it does.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the target element",
        },
        text: {
          type: "string",
          description: "The tooltip text to display",
        },
        durationMs: {
          type: "number",
          description: "How long to show the tooltip in milliseconds. Default: 3000",
        },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "showSection",
    description:
      "Scroll to and highlight a section of the current page.",
    input_schema: {
      type: "object" as const,
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the section to show, e.g. #environment-variables",
        },
      },
      required: ["selector"],
    },
  },
];

/** Shared resources: Anthropic client + cached system prompt */
export interface KonciergeCore {
  client: Anthropic;
  systemPrompt: Anthropic.Messages.TextBlockParam[];
  knowledgeBaseChars: number;
}

/** Per-user conversation state keyed by session token */
export interface ConversationSession {
  history: MessageParam[];
  createdAt: number;
}

/** In-memory session store */
const sessions = new Map<string, ConversationSession>();

/** Get or create a conversation session for a given token */
export function getSession(token: string): ConversationSession {
  let session = sessions.get(token);
  if (!session) {
    session = { history: [], createdAt: Date.now() };
    sessions.set(token, session);
  }
  return session;
}

/** Return active session count (for /health) */
export function getSessionCount(): number {
  return sessions.size;
}

/**
 * Load knowledge base and agent instructions from disk,
 * construct the cached system prompt, and initialise the Anthropic client.
 */
export async function createSession(): Promise<KonciergeCore> {
  const root = import.meta.dir + "/..";

  // Task 0 — Read KAPABLE_KNOWLEDGE_BASE.md
  const knowledgeBase = await Bun.file(`${root}/knowledge/KAPABLE_KNOWLEDGE_BASE.md`).text();

  // Task 1 — Read agents/koncierge.md
  const agentInstructions = await Bun.file(`${root}/agents/koncierge.md`).text();

  // Task 4 — Log knowledge base size
  console.log(`Knowledge base loaded: ${knowledgeBase.length} chars`);
  console.log(`Agent instructions loaded: ${agentInstructions.length} chars`);

  // Task 2 — Compose system prompt with both documents
  // The knowledge base is large and stable → mark it for prompt caching.
  // The agent instructions are smaller but also stable → cache them too.
  const systemPrompt: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text" as const,
      text: knowledgeBase,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text" as const,
      text: agentInstructions,
      cache_control: { type: "ephemeral" },
    },
  ];

  // Task 3 — Initialise Anthropic client
  // Support both direct Anthropic keys and OpenRouter keys.
  // If OPENROUTER_API_KEY is set, use OpenRouter as the base URL.
  // Otherwise, ANTHROPIC_API_KEY is read from env automatically by the SDK.
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const client = openrouterKey
    ? new Anthropic({
        apiKey: openrouterKey,
        // SDK appends /v1/messages, so base must NOT include /v1
        baseURL: "https://openrouter.ai/api",
      })
    : new Anthropic();

  return {
    client,
    systemPrompt,
    knowledgeBaseChars: knowledgeBase.length,
  };
}

export interface RouteContext {
  route?: string;
  pageTitle?: string;
}

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

/**
 * Send a user message and stream the assistant response.
 * Returns a MessageStream whose `text` events yield token deltas.
 * Appends the user message to history immediately; the caller must
 * call `collectResponse()` after streaming to append the assistant reply.
 */
export function chatStream(
  core: KonciergeCore,
  conversation: ConversationSession,
  userMessage: string,
  routeContext?: RouteContext,
): MessageStream<null> {
  const fullMessage = buildUserMessage(userMessage, routeContext);
  conversation.history.push({ role: "user", content: fullMessage });

  const stream = core.client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: core.systemPrompt,
    messages: conversation.history,
    tools: KONCIERGE_TOOLS,
  });

  return stream;
}

/**
 * After streaming completes, append the full assistant response to conversation history.
 * If the response contains tool_use blocks, also append synthetic tool_result messages
 * so the conversation remains valid for future turns.
 */
export function appendAssistantMessage(
  conversation: ConversationSession,
  text: string,
  toolUseBlocks?: ToolUseBlock[],
): void {
  if (!toolUseBlocks || toolUseBlocks.length === 0) {
    // Simple text-only response
    conversation.history.push({ role: "assistant", content: text });
    return;
  }

  // Build content array with text + tool_use blocks
  const content: Array<Anthropic.Messages.TextBlock | ToolUseBlock> = [];
  if (text) {
    content.push({ type: "text", text });
  }
  for (const block of toolUseBlocks) {
    content.push(block);
  }
  conversation.history.push({ role: "assistant", content });

  // Append synthetic tool_result for each tool_use so the conversation stays valid
  const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
  for (const block of toolUseBlocks) {
    toolResults.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: "Done",
    });
  }
  conversation.history.push({ role: "user", content: toolResults });
}

export { MODEL };
