/**
 * Concrete requireAuth factory for the Kapable console.
 *
 * Bridges the console's session cookie (read via React Router's
 * createCookieSessionStorage) to Koncierge's AuthIdentity interface.
 *
 * The console stores: { authMode, sessionToken, orgId, orgName, name, email, role }
 * This adapter maps those fields to AuthIdentity and optionally resolves
 * the real org_member.id via the Kapable API for stable per-user isolation.
 *
 * Usage in the console:
 * ```ts
 * import { createConsoleRequireAuth } from "@kapable/koncierge/bff";
 * import { getSession } from "~/lib/session.server";
 *
 * const requireAuth = createConsoleRequireAuth({
 *   getSessionData: async (req) => {
 *     const session = await getSession(req.headers.get("Cookie"));
 *     if (!session.get("authMode")) return null;
 *     return {
 *       authMode: session.get("authMode"),
 *       sessionToken: session.get("sessionToken"),
 *       userId: session.get("userId"),       // org_member.id if stored
 *       orgId: session.get("orgId"),
 *       email: session.get("email"),
 *       keyType: session.get("keyType"),
 *     };
 *   },
 *   resolveUserId: async (sessionToken) => {
 *     // Call Kapable API to get org_member.id from session token
 *     const res = await fetch(`${API_URL}/v1/auth/me`, {
 *       headers: { "X-Session-Token": sessionToken },
 *     });
 *     if (!res.ok) return null;
 *     const data = await res.json();
 *     return data.id ?? null;
 *   },
 * });
 *
 * const konciergeHandler = createKonciergeRoute(requireAuth);
 * ```
 */

import type { AuthIdentity } from "./extract-user-token";
import type { RequireAuth } from "./api.koncierge.message";

/**
 * Shape of the data stored in the console's session cookie.
 * Matches the fields set during login (session or apikey mode).
 */
export interface ConsoleSessionData {
  authMode: "session" | "apikey";
  /** Platform session token kses_* (session mode) */
  sessionToken?: string | null;
  /** API key (apikey mode) */
  apiKey?: string | null;
  /** org_member.id — present if the console stores it at login time */
  userId?: string | null;
  /** Organisation UUID */
  orgId?: string | null;
  /** Organisation display name */
  orgName?: string | null;
  /** Member's display name */
  name?: string | null;
  /** Member's email */
  email?: string | null;
  /** Member's role (admin, member, viewer) */
  role?: string | null;
  /** API key type: live | admin | etc. (apikey mode) */
  keyType?: string | null;
}

export interface ConsoleRequireAuthOptions {
  /**
   * Read the session data from the request's cookie.
   * The console provides this using its own React Router cookie parser.
   * Return null if no valid session exists (triggers 401).
   */
  getSessionData: (req: Request) => Promise<ConsoleSessionData | null> | ConsoleSessionData | null;

  /**
   * Optional: resolve the real org_member.id from a platform session token.
   * Called when the cookie doesn't contain userId directly.
   *
   * Typical implementation: call GET /v1/auth/me with X-Session-Token header.
   * The returned string is used as the stable key for HMAC token derivation,
   * ensuring the Koncierge session survives across login/logout cycles.
   *
   * If omitted, falls back to the platform sessionToken for HMAC derivation
   * (still works for isolation, but creates a new Koncierge conversation on
   * each login since sessionToken changes).
   */
  resolveUserId?: (sessionToken: string) => Promise<string | null>;
}

/**
 * Create a requireAuth function that bridges the console's session cookie
 * to Koncierge's AuthIdentity.
 *
 * The returned function:
 *   1. Reads session data from the request via getSessionData
 *   2. Optionally resolves the real org_member.id via resolveUserId
 *   3. Returns an AuthIdentity suitable for extractKonciergeToken
 *   4. Throws on missing/invalid session (caught by createKonciergeHandler → 401)
 */
export function createConsoleRequireAuth(
  options: ConsoleRequireAuthOptions,
): RequireAuth {
  return async function requireAuth(req: Request): Promise<AuthIdentity> {
    const session = await options.getSessionData(req);

    if (!session || !session.authMode) {
      throw new Error("No active session — authentication required");
    }

    if (session.authMode === "session") {
      let userId = session.userId ?? null;

      // If userId isn't in the cookie, try to resolve it from the API
      if (!userId && session.sessionToken && options.resolveUserId) {
        userId = await options.resolveUserId(session.sessionToken);
      }

      if (!userId && !session.sessionToken) {
        throw new Error("Session has no userId or sessionToken — cannot authenticate");
      }

      return {
        authMode: "session",
        userId,
        orgId: session.orgId ?? null,
        sessionToken: session.sessionToken ?? null,
      };
    }

    if (session.authMode === "apikey") {
      if (!session.orgId) {
        throw new Error("API key session has no orgId — cannot authenticate");
      }

      return {
        authMode: "apikey",
        orgId: session.orgId,
        keyType: session.keyType ?? null,
      };
    }

    throw new Error(`Unknown auth mode: ${session.authMode}`);
  };
}

/**
 * Create a resolveUserId function that calls the Kapable API.
 *
 * This is the standard implementation for resolving org_member.id
 * from a platform session token. Pass this as the `resolveUserId`
 * option to `createConsoleRequireAuth`.
 *
 * @param apiBaseUrl - Kapable API base URL, e.g. "https://api.kapable.dev"
 * @returns An async function that resolves session token → org_member.id
 */
export function createApiUserResolver(
  apiBaseUrl: string,
): (sessionToken: string) => Promise<string | null> {
  const baseUrl = apiBaseUrl.replace(/\/+$/, "");

  return async function resolveUserId(sessionToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${baseUrl}/v1/auth/me`, {
        headers: { "X-Session-Token": sessionToken },
      });
      if (!res.ok) return null;
      const data = await res.json() as { id?: string; user_id?: string };
      return data.id ?? data.user_id ?? null;
    } catch {
      return null;
    }
  };
}
