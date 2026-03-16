import type { ChatModelAdapter } from "@assistant-ui/react";

/**
 * SSE chat adapter that connects to the Koncierge BFF proxy (or agent server directly).
 *
 * SSE format from backend:
 *   data: {"delta": "text chunk"}
 *   data: [DONE]
 *
 * Tool calls are embedded inline in the agent's text as JSON blocks:
 *   {"tool": "navigate", "route": "/projects"}
 *
 * The adapter extracts these and yields them as tool-call content parts.
 */

export interface KonciergeAdapterOptions {
  /** Endpoint URL, e.g. "/bff/koncierge/message" or "http://localhost:3101/v1/koncierge/message" */
  endpoint: string;
  /** Optional auth headers (X-Koncierge-Key, X-Session-Token injected by BFF) */
  headers?: Record<string, string>;
  /** Current route path for context injection */
  getRouteContext?: () => { route?: string; pageTitle?: string };
}

/** Regex to match inline tool call JSON blocks in the agent's text */
const TOOL_CALL_RE = /\{"tool"\s*:\s*"(\w+)"[^}]*\}/g;

let toolCallCounter = 0;

function extractToolCalls(text: string) {
  const toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }> = [];

  const matches = text.matchAll(TOOL_CALL_RE);
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[0]);
      const { tool, ...args } = parsed;
      toolCalls.push({
        toolCallId: `tc_${++toolCallCounter}`,
        toolName: tool,
        args,
      });
    } catch {
      // skip malformed JSON
    }
  }

  return toolCalls;
}

function stripToolCallJson(text: string): string {
  return text.replace(TOOL_CALL_RE, "").trim();
}

export function createKonciergeAdapter(
  options: KonciergeAdapterOptions,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      // Extract the latest user message
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== "user") return;

      const textParts = lastMessage.content.filter(
        (p): p is { type: "text"; text: string } => p.type === "text",
      );
      const userText = textParts.map((p) => p.text).join("\n");

      const routeCtx = options.getRouteContext?.() ?? {};

      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify({
          message: userText,
          route: routeCtx.route,
          pageTitle: routeCtx.pageTitle,
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Koncierge request failed (${response.status}): ${errorText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();

          if (payload === "[DONE]") break;

          try {
            const event = JSON.parse(payload);
            if (event.delta) {
              fullText += event.delta;
            }
            if (event.error) {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // skip malformed SSE
            throw e;
          }

          // Yield current state — clean text + any detected tool calls
          const cleanText = stripToolCallJson(fullText);
          const toolCalls = extractToolCalls(fullText);

          const content: Array<
            | { type: "text"; text: string }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                args: Record<string, unknown>;
              }
          > = [];

          if (cleanText) {
            content.push({ type: "text", text: cleanText });
          }

          for (const tc of toolCalls) {
            content.push({ type: "tool-call", ...tc });
          }

          if (content.length > 0) {
            yield { content };
          }
        }
      }

      // Final yield with complete content
      const cleanText = stripToolCallJson(fullText);
      const toolCalls = extractToolCalls(fullText);

      const content: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
          }
      > = [];

      if (cleanText) {
        content.push({ type: "text", text: cleanText });
      }

      for (const tc of toolCalls) {
        content.push({ type: "tool-call", ...tc });
      }

      if (content.length > 0) {
        yield { content };
      }
    },
  };
}
