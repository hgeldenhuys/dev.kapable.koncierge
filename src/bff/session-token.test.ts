import { describe, it, expect } from "bun:test";
import { generateSessionToken, generateSessionTokenFromEnv } from "./session-token";

describe("generateSessionToken", () => {
  const secret = "test-secret-abc";

  it("returns a 64-char hex string", () => {
    const token = generateSessionToken("user-123", secret);
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it("is deterministic — same inputs produce same token", () => {
    const a = generateSessionToken("user-123", secret);
    const b = generateSessionToken("user-123", secret);
    expect(a).toBe(b);
  });

  it("produces different tokens for different users", () => {
    const a = generateSessionToken("user-aaa", secret);
    const b = generateSessionToken("user-bbb", secret);
    expect(a).not.toBe(b);
  });

  it("produces different tokens for different secrets", () => {
    const a = generateSessionToken("user-123", "secret-1");
    const b = generateSessionToken("user-123", "secret-2");
    expect(a).not.toBe(b);
  });

  it("throws if userId is empty", () => {
    expect(() => generateSessionToken("", secret)).toThrow("userId is required");
  });

  it("throws if secret is empty", () => {
    expect(() => generateSessionToken("user-123", "")).toThrow("secret is required");
  });
});

describe("generateSessionTokenFromEnv", () => {
  it("returns null when KONCIERGE_SECRET is not set", () => {
    const orig = process.env['KONCIERGE_SECRET'];
    delete process.env['KONCIERGE_SECRET'];

    expect(generateSessionTokenFromEnv("user-123")).toBeNull();

    if (orig !== undefined) process.env['KONCIERGE_SECRET'] = orig;
    else delete process.env['KONCIERGE_SECRET'];
  });

  it("returns a token when KONCIERGE_SECRET is set", () => {
    const orig = process.env['KONCIERGE_SECRET'];
    process.env['KONCIERGE_SECRET'] = "env-secret-xyz";

    const token = generateSessionTokenFromEnv("user-456");
    expect(token).not.toBeNull();
    expect(token).toHaveLength(64);

    // Verify it matches direct generation
    const expected = generateSessionToken("user-456", "env-secret-xyz");
    expect(token).toBe(expected);

    if (orig !== undefined) process.env['KONCIERGE_SECRET'] = orig;
    else delete process.env['KONCIERGE_SECRET'];
  });
});
