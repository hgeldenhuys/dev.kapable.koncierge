import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

const MODEL = "claude-sonnet-4-20250514";

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
  // ANTHROPIC_API_KEY is read from env automatically by the SDK
  const client = new Anthropic();

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
function buildUserMessage(message: string, ctx?: RouteContext): string {
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
): MessageStream {
  const fullMessage = buildUserMessage(userMessage, routeContext);
  conversation.history.push({ role: "user", content: fullMessage });

  const stream = core.client.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: core.systemPrompt,
    messages: conversation.history,
  });

  return stream;
}

/**
 * After streaming completes, append the full assistant text to conversation history.
 */
export function appendAssistantMessage(
  conversation: ConversationSession,
  text: string,
): void {
  conversation.history.push({ role: "assistant", content: text });
}

export { MODEL };
