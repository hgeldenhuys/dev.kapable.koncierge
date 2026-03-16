import type { ChatModelAdapter, ChatModelRunOptions } from "@assistant-ui/react";
import { parseSSE } from "./parse-sse";

/** Shape of SSE data events from the Koncierge server */
interface KonciergeSSEEvent {
  delta?: string;
  error?: string;
}

const MAX_RETRIES = 3;
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 30000;

function backoffDelay(attempt: number): number {
  const delay = Math.min(BACKOFF_MIN_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  // Add jitter: ±25%
  return delay * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
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
  /** Called when a non-recoverable error occurs (e.g. for toast notifications) */
  onError?: (message: string) => void;
}

/**
 * ChatModelAdapter that connects to the Koncierge SSE backend.
 *
 * Streams text deltas from the server and yields them as assistant-ui
 * content updates. Includes retry with exponential backoff for transient
 * network failures (5xx / network errors). Does NOT retry on 4xx client errors.
 *
 * SSE protocol:
 *   data: {"delta":"..."} — text content delta
 *   data: {"error":"..."} — server error
 *   data: [DONE]          — stream complete
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

      if (!userText.trim()) return;

      let response: Response | undefined;
      let lastError = "";

      // Retry loop with exponential backoff
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          response = await fetch(config.endpoint, {
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

          // Don't retry on 4xx client errors — only on 5xx / network failures
          if (response.ok || (response.status >= 400 && response.status < 500)) {
            break;
          }

          lastError = `Koncierge error (${response.status})`;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          lastError = "Network error — could not reach the server";
        }

        // If we have retries left, wait with backoff
        if (attempt < MAX_RETRIES) {
          try {
            await sleep(backoffDelay(attempt), abortSignal);
          } catch {
            return; // Aborted during backoff
          }
        }
      }

      if (!response) {
        const msg = lastError || "Network error — could not reach the server";
        config.onError?.(msg);
        yield { content: [{ type: "text" as const, text: "Sorry, I couldn't connect after several attempts. Please try again." }] };
        return;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "Unknown error");
        const msg = `Koncierge error (${response.status}): ${body}`;
        config.onError?.(msg);
        yield { content: [{ type: "text" as const, text: "Sorry, something went wrong. Please try again." }] };
        return;
      }

      if (!response.body) {
        config.onError?.("Koncierge response has no body");
        yield { content: [{ type: "text" as const, text: "Sorry, something went wrong. Please try again." }] };
        return;
      }

      let fullText = "";

      for await (const event of parseSSE<KonciergeSSEEvent>(
        response.body,
        abortSignal,
      )) {
        if (event.error) {
          config.onError?.(`Koncierge error: ${event.error}`);
          fullText += `\n\n⚠️ ${event.error}`;
          yield { content: [{ type: "text" as const, text: fullText }] };
          continue;
        }

        if (event.delta) {
          fullText += event.delta;
          yield { content: [{ type: "text" as const, text: fullText }] };
        }
      }

      // Final yield with complete text
      yield { content: [{ type: "text" as const, text: fullText }] };
    },
  };
}
