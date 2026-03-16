/**
 * Derives a stable Koncierge session token from the console's auth context.
 *
 * The console has two auth modes:
 *   - "session" (password login): userId is available → HMAC(userId, secret)
 *   - "apikey" (API key login): no userId, but orgId + keyType → HMAC(orgId:keyType, secret)
 *
 * This ensures every authenticated identity gets a unique, deterministic,
 * non-forgeable session token that survives page reloads.
 */

import { generateSessionToken } from "./session-token";

/**
 * Minimal auth identity — matches the shape returned by the console's
 * `requireAuth()` without importing the console's types directly.
 */
export interface AuthIdentity {
  authMode: string;
  /** User ID from session-based auth (null in apikey mode) */
  userId?: string | null;
  /** Organisation ID (present in both auth modes) */
  orgId?: string | null;
  /** API key type: "live" | "admin" | etc. (apikey mode only) */
  keyType?: string | null;
  /** Platform session token (session mode only — NOT the Koncierge token) */
  sessionToken?: string | null;
}

/**
 * Derive a stable Koncierge session token from the authenticated user's identity.
 *
 * @param identity - Auth context from the console's `requireAuth()`
 * @param secret   - KONCIERGE_SECRET (the HMAC key)
 * @returns 64-char hex token, or null if identity is insufficient
 */
export function extractKonciergeToken(
  identity: AuthIdentity,
  secret: string,
): string | null {
  if (!secret) return null;

  // Session auth: use userId for per-user isolation
  if (identity.authMode === "session") {
    const userId = identity.userId;
    if (userId) {
      return generateSessionToken(`session:${userId}`, secret);
    }
    // Fallback: use the platform session token if userId is somehow missing
    if (identity.sessionToken) {
      return generateSessionToken(`session-tok:${identity.sessionToken}`, secret);
    }
    return null;
  }

  // API key auth: use orgId + keyType for per-key isolation
  if (identity.authMode === "apikey") {
    const orgId = identity.orgId;
    if (orgId) {
      const keyType = identity.keyType || "live";
      return generateSessionToken(`apikey:${orgId}:${keyType}`, secret);
    }
    return null;
  }

  return null;
}

/**
 * Convenience wrapper that reads KONCIERGE_SECRET from the environment.
 *
 * Usage in the console's BFF route:
 * ```ts
 * import { extractKonciergeTokenFromEnv } from "@kapable/koncierge/bff";
 *
 * const auth = await requireAuth(request);
 * const konciergeToken = extractKonciergeTokenFromEnv(auth);
 * ```
 */
export function extractKonciergeTokenFromEnv(
  identity: AuthIdentity,
): string | null {
  const secret = process.env['KONCIERGE_SECRET'];
  if (!secret) return null;
  return extractKonciergeToken(identity, secret);
}
