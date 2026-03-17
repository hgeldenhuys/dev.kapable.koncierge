import {
  createSession,
  getSessionCount,
  chatStream,
  extractToolCalls,
  type KonciergeCore,
} from "./session";

const PORT = Number(process.env.PORT) || 3101;
const KONCIERGE_SECRET = process.env.KONCIERGE_SECRET ?? "";

/** Origins allowed to call the Koncierge API */
const ALLOWED_ORIGINS = new Set([
  "https://console.kapable.dev",
  "http://localhost:3005",
]);

/** Build CORS headers, reflecting the request origin only if it's allowed */
function corsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin =
    requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
      ? requestOrigin
      : "";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token, X-Koncierge-Key",
    Vary: "Origin",
  };
}

// ─── NDJSON stream parser ────────────────────────────────────────────────────

interface CCEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{ type: string; text?: string; thinking?: string }>;
  };
  result?: string;
}

/**
 * Extract text from a CC assistant event's content blocks.
 */
function extractTextFromEvent(event: CCEvent): string {
  if (!event.message?.content) return "";
  let text = "";
  for (const block of event.message.content) {
    if (block.type === "text" && block.text) {
      text += block.text;
    }
  }
  return text;
}

/**
 * Chunk text into segments for synthetic streaming.
 * Splits on word boundaries for natural reading flow.
 */
function chunkText(text: string, maxChunkSize: number = 30): string[] {
  if (text.length <= maxChunkSize) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    // Find a word boundary near maxChunkSize
    let splitAt = maxChunkSize;
    const spaceIdx = remaining.lastIndexOf(" ", maxChunkSize);
    const newlineIdx = remaining.lastIndexOf("\n", maxChunkSize);

    if (newlineIdx > 0) {
      splitAt = newlineIdx + 1; // include the newline
    } else if (spaceIdx > maxChunkSize / 2) {
      splitAt = spaceIdx + 1; // include the space
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ─── Server ──────────────────────────────────────────────────────────────────

let core: KonciergeCore;

try {
  core = await createSession();
} catch (err) {
  console.error("Failed to initialise Koncierge session:", err);
  process.exit(1);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const cors = corsHeaders(origin);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check (no auth required)
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json(
        {
          status: "ok",
          version: "0.2.0",
          backend: "claude-code",
          knowledgeBaseChars: core.knowledgeBaseChars,
          activeSessions: getSessionCount(),
        },
        { status: 200, headers: cors },
      );
    }

    // POST /v1/koncierge/message — SSE streaming chat
    if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
      // Auth: validate shared secret
      if (!KONCIERGE_SECRET) {
        console.error("KONCIERGE_SECRET env var is not set — rejecting all requests");
        return Response.json(
          { error: "Server misconfigured" },
          { status: 500, headers: cors },
        );
      }

      const apiKey = req.headers.get("X-Koncierge-Key");
      if (!apiKey || apiKey !== KONCIERGE_SECRET) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: cors },
        );
      }

      // Validate session token
      const sessionToken = req.headers.get("X-Session-Token");
      if (!sessionToken) {
        return Response.json(
          { error: "Missing X-Session-Token header" },
          { status: 401, headers: cors },
        );
      }

      // Parse request body
      let body: { message?: string; route?: string; pageTitle?: string };
      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: "Invalid JSON body" },
          { status: 400, headers: cors },
        );
      }

      if (!body.message || typeof body.message !== "string") {
        return Response.json(
          { error: "Missing or invalid 'message' field" },
          { status: 400, headers: cors },
        );
      }

      // Log route context for observability
      console.log(
        `[koncierge] route=${body.route ?? "(none)"} pageTitle=${body.pageTitle ?? "(none)"} session=${sessionToken.slice(0, 8)}…`,
      );

      // Spawn CC subprocess
      const { stdout, process: proc } = chatStream(core, sessionToken, body.message, {
        route: body.route,
        pageTitle: body.pageTitle,
      });

      // Build SSE ReadableStream from CC's NDJSON output
      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          try {
            const reader = stdout.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let accumulatedText = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.trim()) continue;

                let event: CCEvent;
                try {
                  event = JSON.parse(line);
                } catch {
                  continue; // skip malformed lines
                }

                // Handle assistant events — extract text deltas
                if (event.type === "assistant" && event.message?.content) {
                  const fullText = extractTextFromEvent(event);

                  if (fullText.length > accumulatedText.length) {
                    const newText = fullText.slice(accumulatedText.length);
                    accumulatedText = fullText;

                    // Process for tool calls
                    const { cleanText, toolCalls } = extractToolCalls(newText);

                    // Emit tool calls as SSE events
                    for (const tc of toolCalls) {
                      const sseData = JSON.stringify({
                        tool_use: { id: tc.id, name: tc.name, input: tc.input },
                      });
                      controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                    }

                    // Emit clean text as chunked deltas for streaming feel
                    if (cleanText.trim()) {
                      const chunks = chunkText(cleanText);
                      for (const chunk of chunks) {
                        const sseData = JSON.stringify({ delta: chunk });
                        controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
                        // Yield to event loop so chunks flush as separate TCP frames
                        await new Promise(r => setTimeout(r, 15));
                      }
                    }
                  }
                }

                // Handle result event — stream is done
                if (event.type === "result") {
                  // result.result may have the final text — check for any remaining
                  // tool calls in the full accumulated text (safety net)
                  break;
                }
              }
            }

            // Wait for process to exit
            await proc.exited;

            // Check for errors
            if (proc.exitCode !== 0) {
              // Read stderr for error details
              const stderrReader = proc.stderr.getReader();
              let stderrText = "";
              const stderrDecoder = new TextDecoder();
              while (true) {
                const { done: stderrDone, value: stderrValue } = await stderrReader.read();
                if (stderrDone) break;
                stderrText += stderrDecoder.decode(stderrValue, { stream: true });
              }

              if (accumulatedText.length === 0) {
                // No text was emitted — report the error
                const errorMsg = stderrText.trim() || `Claude Code exited with code ${proc.exitCode}`;
                console.error("[koncierge] CC error:", errorMsg);
                const sseData = JSON.stringify({ error: errorMsg });
                controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
              }
            }

            // Signal completion
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown streaming error";
            console.error("[koncierge] Streaming error:", errorMsg);
            const sseData = JSON.stringify({ error: errorMsg });
            controller.enqueue(encoder.encode(`data: ${sseData}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return Response.json(
      { error: "Not Found" },
      { status: 404, headers: cors },
    );
  },
});

console.log(`Koncierge server listening on http://localhost:${server.port} (Claude Code backend)`);
