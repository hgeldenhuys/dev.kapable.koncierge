import { describe, it, expect } from "bun:test";
import {
  trackSession,
  getSessionCount,
  buildUserMessage,
} from "./session";

/**
 * Session isolation test.
 *
 * With the Claude Code backend, session isolation is handled by CC via
 * --session-id. Each unique token creates an independent CC session.
 * These tests verify our local session tracking and message building.
 */

describe("Session tracking isolation", () => {
  it("distinct tokens produce distinct session count", () => {
    const before = getSessionCount();
    const token1 = `isolation-alice-${Date.now()}`;
    const token2 = `isolation-bob-${Date.now()}`;

    trackSession(token1);
    trackSession(token2);

    expect(getSessionCount()).toBe(before + 2);
  });

  it("same token tracked twice does not double-count", () => {
    const token = `isolation-same-${Date.now()}`;
    const before = getSessionCount();

    trackSession(token);
    trackSession(token);

    expect(getSessionCount()).toBe(before + 1);
  });
});

describe("Message building isolation", () => {
  it("different route contexts produce different messages", () => {
    const msg1 = buildUserMessage("what is this page?", {
      route: "/flows",
      pageTitle: "AI Flows",
    });
    const msg2 = buildUserMessage("what is this page?", {
      route: "/settings/team",
      pageTitle: "Team Settings",
    });

    expect(msg1).toContain("/flows");
    expect(msg1).not.toContain("/settings/team");
    expect(msg2).toContain("/settings/team");
    expect(msg2).not.toContain("/flows");
  });

  it("building message for Alice does not affect Bob's message", () => {
    const aliceMsg = buildUserMessage("Hello from Alice", { route: "/dashboard" });
    const bobMsg = buildUserMessage("Hello from Bob", { route: "/projects" });

    expect(aliceMsg).toContain("Alice");
    expect(aliceMsg).not.toContain("Bob");
    expect(bobMsg).toContain("Bob");
    expect(bobMsg).not.toContain("Alice");
  });
});
