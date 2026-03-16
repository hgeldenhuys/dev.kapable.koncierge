/**
 * BFF proxy handler for /api/koncierge/message.
 *
 * The console server imports this handler and mounts it on
 * POST /api/koncierge/message. It forwards the request to the
 * Koncierge backend at KONCIERGE_URL, injecting the shared secret
 * (X-Koncierge-Key) so it never reaches the browser. The SSE
 * response is piped back to the client via TransformStream.
 */

export interface BffProxyConfig {
  /** Base URL of the Koncierge backend, e.g. "http://localhost:3101" */
  konciergeUrl: string;
  /** Shared secret sent as X-Koncierge-Key to the Koncierge backend */
  konciergeSecret: string;
}

/**
 * Resolve config from env vars (KONCIERGE_URL, KONCIERGE_SECRET).
 * Returns null if either is missing.
 */
export function configFromEnv(): BffProxyConfig | null {
  const konciergeUrl = process.env['KONCIERGE_URL'];
  const konciergeSecret = process.env['KONCIERGE_SECRET'];
  if (!konciergeUrl || !konciergeSecret) return null;
  return { konciergeUrl: konciergeUrl.replace(/\/+$/, ""), konciergeSecret };
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | string;
}

/**
 * Proxy a POST /api/koncierge/message request to the Koncierge backend.
 *
 * @param req       - The incoming Request from the browser
 * @param config    - BFF proxy config (URL + secret)
 * @param sessionToken - The authenticated user's session token (extracted by the console's auth layer)
 * @returns ProxyResult with status, headers, and body to return to the client
 */
export async function proxyKonciergeMessage(
  req: Request,
  config: BffProxyConfig,
  sessionToken: string,
): Promise<ProxyResult> {
  // Read the body once — we'll forward it verbatim
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to read request body" }),
    };
  }

  // Validate the JSON has a message field
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed.message || typeof parsed.message !== "string") {
      return {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing or invalid 'message' field" }),
      };
    }
  } catch {
    return {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  // Forward to the Koncierge backend
  const upstreamUrl = `${config.konciergeUrl}/v1/koncierge/message`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Koncierge-Key": config.konciergeSecret,
        "X-Session-Token": sessionToken,
      },
      body: rawBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      status: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Koncierge backend unreachable: ${message}` }),
    };
  }

  // If upstream returned an error, relay it
  if (!upstream.ok) {
    const errorBody = await upstream.text().catch(() => "");
    return {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
      body: errorBody || JSON.stringify({ error: `Upstream error ${upstream.status}` }),
    };
  }

  // Stream the SSE response back via TransformStream (zero-copy pipe)
  if (!upstream.body) {
    return {
      status: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Koncierge backend returned empty body" }),
    };
  }

  const { readable, writable } = new TransformStream<Uint8Array>();
  // Pipe in background — errors just close the stream
  upstream.body.pipeTo(writable).catch(() => {});

  return {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body: readable,
  };
}

/**
 * Full request handler for mounting in a Bun server's fetch callback.
 *
 * Usage in the console server:
 * ```ts
 * import { handleKonciergeProxy, configFromEnv } from "@kapable/koncierge/bff";
 *
 * const proxyConfig = configFromEnv();
 *
 * Bun.serve({
 *   async fetch(req) {
 *     const url = new URL(req.url);
 *     if (req.method === "POST" && url.pathname === "/api/koncierge/message") {
 *       const sessionToken = await getSessionToken(req); // your auth layer
 *       return handleKonciergeProxy(req, proxyConfig, sessionToken);
 *     }
 *     // ... other routes
 *   }
 * });
 * ```
 */
export async function handleKonciergeProxy(
  req: Request,
  config: BffProxyConfig | null,
  sessionToken: string | null,
): Promise<Response> {
  // Config check
  if (!config) {
    return Response.json(
      { error: "Koncierge proxy not configured (missing KONCIERGE_URL or KONCIERGE_SECRET)" },
      { status: 503 },
    );
  }

  // Auth check
  if (!sessionToken) {
    return Response.json(
      { error: "Unauthorized — missing session token" },
      { status: 401 },
    );
  }

  const result = await proxyKonciergeMessage(req, config, sessionToken);

  return new Response(
    typeof result.body === "string" ? result.body : result.body,
    { status: result.status, headers: result.headers },
  );
}
