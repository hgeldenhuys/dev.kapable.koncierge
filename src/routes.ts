import {
  getSession,
  getSessionCount,
  chatStream,
  appendAssistantMessage,
  type KonciergeCore,
} from "./session";

/** Handle GET /health — no auth required */
export function handleHealth(
  core: KonciergeCore,
  cors: Record<string, string>,
): Response {
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

/** Handle POST /v1/koncierge/message — SSE streaming chat */
export async function handleMessage(
  req: Request,
  core: KonciergeCore,
  cors: Record<string, string>,
): Promise<Response> {
  // Auth: validate shared secret (read at request time for testability)
  const KONCIERGE_SECRET = process.env.KONCIERGE_SECRET ?? "";
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

  // Start streaming from Claude, passing the request signal for abort-on-disconnect
  const stream = chatStream(core, conversation, body.message, {
    route: body.route,
    pageTitle: body.pageTitle,
  }, req.signal);

  // Build SSE ReadableStream
  const encoder = new TextEncoder();
  let fullText = "";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        // Abort the Claude stream if the client disconnects
        req.signal.addEventListener("abort", () => {
          stream.controller.abort();
        }, { once: true });

        stream.on("text", (delta: string) => {
          fullText += delta;
          const chunk = `data: ${JSON.stringify({ delta })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        });

        // Wait for the stream to finish
        await stream.finalMessage();

        // Append complete assistant response to conversation history
        appendAssistantMessage(conversation, fullText);

        // Signal completion
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        // Don't log abort errors — they're expected on client disconnect
        if (req.signal.aborted) {
          // Still save partial response to history if we got anything
          if (fullText) appendAssistantMessage(conversation, fullText);
          controller.close();
          return;
        }
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
