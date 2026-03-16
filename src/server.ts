import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import {
  createSession,
  getSession,
  getSessionCount,
  chatStream,
  appendAssistantMessage,
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

// Initialise the warm Claude session before starting the server
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
          version: "0.1.0",
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

      // Get or create conversation for this session token
      const conversation = getSession(sessionToken);

      // Start streaming from Claude
      const stream = chatStream(core, conversation, body.message, {
        route: body.route,
        pageTitle: body.pageTitle,
      });

      // Build SSE ReadableStream
      const encoder = new TextEncoder();
      let fullText = "";
      const toolUseBlocks: ToolUseBlock[] = [];

      const readable = new ReadableStream({
        async start(controller) {
          try {
            stream.on("text", (delta: string) => {
              fullText += delta;
              const chunk = `data: ${JSON.stringify({ delta })}\n\n`;
              controller.enqueue(encoder.encode(chunk));
            });

            // Capture completed content blocks — tool_use blocks are emitted as SSE events
            stream.on("contentBlock", (block) => {
              if (block.type === "tool_use") {
                toolUseBlocks.push(block as ToolUseBlock);
                const chunk = `data: ${JSON.stringify({
                  tool_use: {
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  },
                })}\n\n`;
                controller.enqueue(encoder.encode(chunk));
              }
            });

            // Wait for the stream to finish
            await stream.finalMessage();

            // Append complete assistant response to conversation history
            // (includes tool_use blocks + synthetic tool_results for valid history)
            appendAssistantMessage(conversation, fullText, toolUseBlocks);

            // Signal completion
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown streaming error";
            console.error("Streaming error:", errorMsg);
            const chunk = `data: ${JSON.stringify({ error: errorMsg })}\n\n`;
            controller.enqueue(encoder.encode(chunk));
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

console.log(`Koncierge server listening on http://localhost:${server.port}`);
