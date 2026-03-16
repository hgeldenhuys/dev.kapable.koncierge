/**
 * Generates stable, deterministic Koncierge session tokens from user identity.
 *
 * The token is an HMAC-SHA256 hex digest keyed by KONCIERGE_SECRET over the
 * user ID. This means:
 *   - Same user always gets the same token (survives page reloads)
 *   - Token can't be forged without knowing the secret
 *   - Different users get different tokens (conversation isolation)
 */

import { createHmac } from "node:crypto";

/**
 * Generate a stable Koncierge session token for a given user.
 *
 * @param userId  - Unique user identifier (e.g. UUID from the auth session)
 * @param secret  - The KONCIERGE_SECRET used as HMAC key
 * @returns 64-char hex string (SHA-256 HMAC digest)
 * @throws If userId or secret is empty
 */
export function generateSessionToken(userId: string, secret: string): string {
  if (!userId) throw new Error("userId is required for session token generation");
  if (!secret) throw new Error("secret is required for session token generation");

  return createHmac("sha256", secret).update(userId).digest("hex");
}

/**
 * Generate a session token using KONCIERGE_SECRET from environment.
 *
 * Convenience wrapper for use in the console's auth layer:
 * ```ts
 * import { generateSessionTokenFromEnv } from "@kapable/koncierge/bff";
 *
 * // In your login handler or session restore:
 * const konciergeToken = generateSessionTokenFromEnv(user.id);
 * // Store in session cookie or inject into the page
 * ```
 *
 * @param userId - Unique user identifier
 * @returns 64-char hex token, or null if KONCIERGE_SECRET is not set
 */
export function generateSessionTokenFromEnv(userId: string): string | null {
  const secret = process.env["KONCIERGE_SECRET"];
  if (!secret) return null;
  return generateSessionToken(userId, secret);
}
