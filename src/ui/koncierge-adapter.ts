import type { ChatModelAdapter, ChatModelRunOptions } from "@assistant-ui/react";
import { parseSSE } from "./parse-sse";

/** Shape of SSE data events from the Koncierge server */
interface KonciergeSSEEvent {
  delta?: string;
  error?: string;
}

export interface KonciergeAdapterConfig {
  /** BFF proxy endpoint, e.g. "/api/koncierge/message" */
  endpoint: string;
  /** Returns the current route path for context injection */
  getRoute?: () => string;
  /** Returns the current page title for context injection */
  getPageTitle?: () => string;
  /** Session token sent as X-Session-Token header on every request */
  sessionToken?: string;
  /** Additional headers (e.g. auth tokens) */
  headers?: Record<string, string>;
}

/**
 * ChatModelAdapter that connects to the Koncierge SSE backend.
 *
 * Streams text deltas from the server and yields them as assistant-ui
 * content updates. The adapter uses fetch + ReadableStream (not EventSource)
 * to support POST requests with custom headers.
 */
export function createKonciergeAdapter(
  config: KonciergeAdapterConfig,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      // Extract the last user message text
      const lastMessage = messages[messages.length - 1];
      let userText = "";
      if (lastMessage?.role === "user") {
        for (const part of lastMessage.content) {
          if (part.type === "text") {
            userText += part.text;
          }
        }
      }

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.sessionToken ? { "X-Session-Token": config.sessionToken } : {}),
          ...config.headers,
        },
        body: JSON.stringify({
          message: userText,
          route: config.getRoute?.(),
          pageTitle: config.getPageTitle?.(),
        }),
        signal: abortSignal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Koncierge request failed (${response.status}): ${body}`,
        );
      }

      if (!response.body) {
        throw new Error("Koncierge response has no body");
      }

      let fullText = "";

      for await (const event of parseSSE<KonciergeSSEEvent>(
        response.body,
        abortSignal,
      )) {
        if (event.error) {
          throw new Error(`Koncierge error: ${event.error}`);
        }

        if (event.delta) {
          fullText += event.delta;
          yield { content: [{ type: "text" as const, text: fullText }] };
        }
      }

      // Final yield with complete text (if not already yielded)
      yield { content: [{ type: "text" as const, text: fullText }] };
    },
  };
}
