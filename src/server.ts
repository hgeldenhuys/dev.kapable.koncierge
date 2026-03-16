import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jwtVerify, createRemoteJWKSet, importSPKI } from "jose";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = Number(process.env.KONCIERGE_PORT ?? 3033);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET; // shared-secret or public key PEM
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Load knowledge base once at startup
// ---------------------------------------------------------------------------
const KNOWLEDGE_BASE_PATH = resolve(
  import.meta.dir,
  "../knowledge/KAPABLE_KNOWLEDGE_BASE.md",
);
let knowledgeBase: string;
try {
  knowledgeBase = readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
  console.log(
    `[koncierge] Knowledge base loaded (${(knowledgeBase.length / 1024).toFixed(1)} KB)`,
  );
} catch (err) {
  console.error(
    `[koncierge] Failed to load knowledge base from ${KNOWLEDGE_BASE_PATH}`,
  );
  console.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load koncierge agent prompt
// ---------------------------------------------------------------------------
const AGENT_PROMPT_PATH = resolve(import.meta.dir, "../agents/koncierge.md");
let agentPrompt: string;
try {
  agentPrompt = readFileSync(AGENT_PROMPT_PATH, "utf-8");
} catch {
  agentPrompt = "";
}

const systemPrompt = [agentPrompt, knowledgeBase].filter(Boolean).join("\n\n---\n\n");

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
if (!ANTHROPIC_API_KEY) {
  console.warn(
    "[koncierge] ANTHROPIC_API_KEY not set — requests will fail. Set it in .env",
  );
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// JWT verification helper
// ---------------------------------------------------------------------------
type AuthPayload = {
  sub: string;
  org_id?: string;
  role?: string;
};

async function verifyJwt(token: string): Promise<AuthPayload> {
  if (!JWT_SECRET) {
    // Dev mode: skip verification, return placeholder
    console.warn("[koncierge] JWT_SECRET not set — auth disabled (dev mode)");
    return { sub: "dev-user" };
  }

  // Support both HMAC shared secret (HS256) and RSA/EC public key (RS256/ES256)
  const secret = JWT_SECRET.startsWith("-----BEGIN")
    ? await importSPKI(JWT_SECRET, "RS256")
    : new TextEncoder().encode(JWT_SECRET);

  const { payload } = await jwtVerify(token, secret);
  return payload as AuthPayload;
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------
const app = new Hono();

// CORS
app.use(
  "*",
  cors({
    origin: CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

// Health check
app.get("/health", (c) => c.json({ status: "ok", model: CLAUDE_MODEL }));

// ---------------------------------------------------------------------------
// Auth middleware for /v1/* routes
// ---------------------------------------------------------------------------
app.use("/v1/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);
  try {
    const payload = await verifyJwt(token);
    c.set("user" as never, payload);
  } catch (err) {
    return c.json({ error: "Invalid token" }, 401);
  }
  await next();
});

// ---------------------------------------------------------------------------
// POST /v1/koncierge/message — streaming SSE
// ---------------------------------------------------------------------------
interface MessageRequest {
  message: string;
  route_context?: string;
  conversation_history?: Array<{ role: "user" | "assistant"; content: string }>;
}

app.post("/v1/koncierge/message", async (c) => {
  const body = await c.req.json<MessageRequest>();

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required and must be a string" }, 400);
  }

  // Build messages array: optional conversation history + current message
  const messages: Anthropic.MessageParam[] = [];

  if (body.conversation_history) {
    for (const msg of body.conversation_history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Inject route context into the user message
  const userContent = body.route_context
    ? `[Current page: ${body.route_context}]\n\n${body.message}`
    : body.message;

  messages.push({ role: "user", content: userContent });

  return streamSSE(c, async (stream) => {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        stream: true,
      });

      for await (const event of response) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if ("text" in delta) {
            await stream.writeSSE({
              event: "token",
              data: JSON.stringify({ type: "token", content: delta.text }),
            });
          }
        } else if (event.type === "message_start") {
          await stream.writeSSE({
            event: "message_start",
            data: JSON.stringify({
              type: "message_start",
              id: event.message.id,
            }),
          });
        } else if (event.type === "message_stop") {
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ type: "done" }),
          });
        }
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      console.error("[koncierge] Streaming error:", errorMessage);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ type: "error", message: errorMessage }),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
console.log(`[koncierge] Starting on port ${PORT}`);
console.log(`[koncierge] Model: ${CLAUDE_MODEL}`);
console.log(`[koncierge] CORS origin: ${CORS_ORIGIN}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
