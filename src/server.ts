import { createSession, type KonciergeCore } from "./session";
import { handleHealth, handleMessage } from "./routes";

const PORT = Number(process.env.PORT) || 3101;

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

    // Route dispatch
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth(core, cors);
    }

    if (req.method === "POST" && url.pathname === "/v1/koncierge/message") {
      return handleMessage(req, core, cors);
    }

    return Response.json(
      { error: "Not Found" },
      { status: 404, headers: cors },
    );
  },
});

console.log(`Koncierge server listening on http://localhost:${server.port}`);
