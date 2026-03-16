import type { RouteContext } from "./useRouteContext";
import { parseToolCalls, type ToolCall } from "./parseToolCalls";

export interface SendMessageOptions {
  /** The user's chat message */
  message: string;
  /** Route context to inject (from useRouteContext) */
  routeContext: RouteContext;
  /** Session token for the current user */
  sessionToken: string;
  /** Base URL for the BFF, defaults to "" (same origin) */
  baseUrl?: string;
  /** AbortSignal to cancel the request */
  signal?: AbortSignal;
}

export interface StreamCallbacks {
  /** Called for each text delta chunk */
  onDelta?: (delta: string) => void;
  /** Called when the stream completes with cleaned text (tool calls stripped) */
  onDone?: (cleanText: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called when tool calls are detected in the completed response */
  onToolCalls?: (toolCalls: ToolCall[]) => void;
}

/**
 * Send a message to the Koncierge BFF and stream the SSE response.
 *
 * Every request includes `route` and `pageTitle` from the current
 * React Router location so the agent can give contextual answers.
 */
export async function sendMessage(
  options: SendMessageOptions,
  callbacks: StreamCallbacks = {},
): Promise<string> {
  const { message, routeContext, sessionToken, baseUrl = "", signal } = options;

  const res = await fetch(`${baseUrl}/api/koncierge/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Token": sessionToken,
    },
    body: JSON.stringify({
      message,
      route: routeContext.route,
      pageTitle: routeContext.pageTitle,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    callbacks.onError?.(err);
    throw err;
  }

  if (!res.body) {
    const err = new Error("No response body — SSE streaming unavailable");
    callbacks.onError?.(err);
    throw err;
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE lines
    const lines = buffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6); // strip "data: "

      if (payload === "[DONE]") {
        const { cleanText, toolCalls } = parseToolCalls(fullText);
        if (toolCalls.length > 0) {
          callbacks.onToolCalls?.(toolCalls);
        }
        callbacks.onDone?.(cleanText);
        return cleanText;
      }

      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) {
          const err = new Error(parsed.error);
          callbacks.onError?.(err);
          throw err;
        }
        if (parsed.delta) {
          fullText += parsed.delta;
          callbacks.onDelta?.(parsed.delta);
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          // Skip malformed JSON lines
          continue;
        }
        throw e;
      }
    }
  }

  // Stream ended without [DONE] — return what we have
  const { cleanText, toolCalls } = parseToolCalls(fullText);
  if (toolCalls.length > 0) {
    callbacks.onToolCalls?.(toolCalls);
  }
  callbacks.onDone?.(cleanText);
  return cleanText;
}
