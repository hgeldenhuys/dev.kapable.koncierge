/**
 * Ready-to-mount route handler for POST /api/koncierge/message.
 *
 * Wires the console's auth layer (requireAuth) to the Koncierge BFF proxy:
 *   1. Extracts the authenticated user's identity via requireAuth
 *   2. Derives a stable, deterministic session token via HMAC(userId, secret)
 *   3. Forwards the request to the Koncierge backend with the token
 *
 * Usage in the console server:
 * ```ts
 * import { createKonciergeRoute } from "@kapable/koncierge/bff";
 * import { requireAuth } from "./auth"; // your console auth layer
 *
 * const konciergeHandler = createKonciergeRoute(requireAuth);
 *
 * Bun.serve({
 *   async fetch(req) {
 *     const url = new URL(req.url);
 *     if (req.method === "POST" && url.pathname === "/api/koncierge/message") {
 *       return konciergeHandler(req);
 *     }
 *   }
 * });
 * ```
 */

import { handleKonciergeProxy, configFromEnv, type BffProxyConfig } from "./proxy";
import { extractKonciergeToken, type AuthIdentity } from "./extract-user-token";

/**
 * Function that extracts the authenticated identity from a request.
 * Matches the shape of the console's `requireAuth()`.
 */
export type RequireAuth = (req: Request) => Promise<AuthIdentity> | AuthIdentity;

export interface KonciergeRouteOptions {
  /** Auth extraction function — typically the console's requireAuth */
  requireAuth: RequireAuth;
  /** KONCIERGE_SECRET used as HMAC key for token derivation */
  secret: string;
  /** BFF proxy config (URL + secret for upstream communication) */
  proxyConfig: BffProxyConfig | null;
}

/**
 * Create a request handler that extracts the user's auth identity,
 * derives a stable Koncierge session token, and proxies to the backend.
 *
 * @param options - Full configuration with auth, secret, and proxy config
 * @returns An async request handler: (req: Request) => Promise<Response>
 */
export function createKonciergeHandler(
  options: KonciergeRouteOptions,
): (req: Request) => Promise<Response> {
  return async function handleKonciergeMessage(req: Request): Promise<Response> {
    // Step 1: Extract the authenticated user's identity
    let identity: AuthIdentity;
    try {
      identity = await options.requireAuth(req);
    } catch {
      return Response.json(
        { error: "Unauthorized — authentication required" },
        { status: 401 },
      );
    }

    // Step 2: Derive a stable session token from the identity
    const sessionToken = extractKonciergeToken(identity, options.secret);

    // Step 3: Forward to the Koncierge backend via the BFF proxy
    return handleKonciergeProxy(req, options.proxyConfig, sessionToken);
  };
}

/**
 * Convenience factory that reads config from environment variables.
 *
 * Reads KONCIERGE_SECRET and KONCIERGE_URL from process.env.
 *
 * @param requireAuth - The console's auth extraction function
 * @returns An async request handler, or null if env vars are missing
 */
export function createKonciergeRoute(
  requireAuth: RequireAuth,
): (req: Request) => Promise<Response> {
  const secret = process.env['KONCIERGE_SECRET'] ?? "";
  const proxyConfig = configFromEnv();

  return createKonciergeHandler({
    requireAuth,
    secret,
    proxyConfig,
  });
}
