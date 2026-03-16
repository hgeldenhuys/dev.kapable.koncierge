import { describe, it, expect } from "bun:test";
import {
  extractKonciergeToken,
  extractKonciergeTokenFromEnv,
  type AuthIdentity,
} from "./extract-user-token";

const SECRET = "test-koncierge-secret";

// ── Session auth mode ───────────────────────────────────────────

describe("extractKonciergeToken — session auth", () => {
  it("returns a 64-char hex token for session auth with userId", () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-abc-123",
      orgId: "org-1",
      sessionToken: "platform-session-tok",
    };
    const token = extractKonciergeToken(identity, SECRET);
    expect(token).not.toBeNull();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token!)).toBe(true);
  });

  it("is deterministic — same userId always yields the same token", () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: "user-abc-123",
      orgId: "org-1",
    };
    const a = extractKonciergeToken(identity, SECRET);
    const b = extractKonciergeToken(identity, SECRET);
    expect(a).toBe(b);
  });

  it("different userIds produce different tokens", () => {
    const alice: AuthIdentity = { authMode: "session", userId: "alice", orgId: "org-1" };
    const bob: AuthIdentity = { authMode: "session", userId: "bob", orgId: "org-1" };
    const tokenA = extractKonciergeToken(alice, SECRET);
    const tokenB = extractKonciergeToken(bob, SECRET);
    expect(tokenA).not.toBe(tokenB);
  });

  it("falls back to sessionToken when userId is missing", () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: null,
      sessionToken: "platform-tok-xyz",
      orgId: "org-1",
    };
    const token = extractKonciergeToken(identity, SECRET);
    expect(token).not.toBeNull();
    expect(token).toHaveLength(64);
  });

  it("returns null when both userId and sessionToken are missing", () => {
    const identity: AuthIdentity = {
      authMode: "session",
      userId: null,
      sessionToken: null,
      orgId: "org-1",
    };
    const token = extractKonciergeToken(identity, SECRET);
    expect(token).toBeNull();
  });
});

// ── API key auth mode ───────────────────────────────────────────

describe("extractKonciergeToken — apikey auth", () => {
  it("returns a 64-char hex token for apikey auth with orgId", () => {
    const identity: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-42",
      keyType: "live",
    };
    const token = extractKonciergeToken(identity, SECRET);
    expect(token).not.toBeNull();
    expect(token).toHaveLength(64);
  });

  it("is deterministic — same orgId+keyType yields the same token", () => {
    const identity: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-42",
      keyType: "live",
    };
    const a = extractKonciergeToken(identity, SECRET);
    const b = extractKonciergeToken(identity, SECRET);
    expect(a).toBe(b);
  });

  it("different orgIds produce different tokens", () => {
    const org1: AuthIdentity = { authMode: "apikey", orgId: "org-1", keyType: "live" };
    const org2: AuthIdentity = { authMode: "apikey", orgId: "org-2", keyType: "live" };
    const token1 = extractKonciergeToken(org1, SECRET);
    const token2 = extractKonciergeToken(org2, SECRET);
    expect(token1).not.toBe(token2);
  });

  it("different keyTypes for same org produce different tokens", () => {
    const live: AuthIdentity = { authMode: "apikey", orgId: "org-1", keyType: "live" };
    const admin: AuthIdentity = { authMode: "apikey", orgId: "org-1", keyType: "admin" };
    const tokenLive = extractKonciergeToken(live, SECRET);
    const tokenAdmin = extractKonciergeToken(admin, SECRET);
    expect(tokenLive).not.toBe(tokenAdmin);
  });

  it("defaults keyType to 'live' when not provided", () => {
    const withType: AuthIdentity = { authMode: "apikey", orgId: "org-1", keyType: "live" };
    const withoutType: AuthIdentity = { authMode: "apikey", orgId: "org-1" };
    const a = extractKonciergeToken(withType, SECRET);
    const b = extractKonciergeToken(withoutType, SECRET);
    expect(a).toBe(b);
  });

  it("returns null when orgId is missing", () => {
    const identity: AuthIdentity = { authMode: "apikey", orgId: null };
    const token = extractKonciergeToken(identity, SECRET);
    expect(token).toBeNull();
  });
});

// ── Cross-mode isolation ────────────────────────────────────────

describe("extractKonciergeToken — cross-mode isolation", () => {
  it("session and apikey tokens are different even with same orgId", () => {
    const session: AuthIdentity = {
      authMode: "session",
      userId: "org-1",
      orgId: "org-1",
    };
    const apikey: AuthIdentity = {
      authMode: "apikey",
      orgId: "org-1",
      keyType: "live",
    };
    const sessionToken = extractKonciergeToken(session, SECRET);
    const apikeyToken = extractKonciergeToken(apikey, SECRET);
    expect(sessionToken).not.toBe(apikeyToken);
  });
});

// ── Edge cases ──────────────────────────────────────────────────

describe("extractKonciergeToken — edge cases", () => {
  it("returns null when secret is empty", () => {
    const identity: AuthIdentity = { authMode: "session", userId: "user-1" };
    expect(extractKonciergeToken(identity, "")).toBeNull();
  });

  it("returns null for unknown authMode", () => {
    const identity: AuthIdentity = { authMode: "oauth", userId: "user-1" };
    expect(extractKonciergeToken(identity, SECRET)).toBeNull();
  });
});

// ── Env wrapper ─────────────────────────────────────────────────

describe("extractKonciergeTokenFromEnv", () => {
  it("returns null when KONCIERGE_SECRET is not set", () => {
    const orig = process.env['KONCIERGE_SECRET'];
    delete process.env['KONCIERGE_SECRET'];

    const identity: AuthIdentity = { authMode: "session", userId: "user-1" };
    expect(extractKonciergeTokenFromEnv(identity)).toBeNull();

    if (orig !== undefined) process.env['KONCIERGE_SECRET'] = orig;
    else delete process.env['KONCIERGE_SECRET'];
  });

  it("returns a token when KONCIERGE_SECRET is set", () => {
    const orig = process.env['KONCIERGE_SECRET'];
    process.env['KONCIERGE_SECRET'] = "env-test-secret";

    const identity: AuthIdentity = { authMode: "session", userId: "user-1" };
    const token = extractKonciergeTokenFromEnv(identity);
    expect(token).not.toBeNull();
    expect(token).toHaveLength(64);

    // Verify it matches direct generation
    const expected = extractKonciergeToken(identity, "env-test-secret");
    expect(token).toBe(expected);

    if (orig !== undefined) process.env['KONCIERGE_SECRET'] = orig;
    else delete process.env['KONCIERGE_SECRET'];
  });
});
