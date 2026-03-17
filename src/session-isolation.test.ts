import { describe, it, expect } from "bun:test";
import {
  getSession,
  appendAssistantMessage,
  buildUserMessage,
  getSessionCount,
  type ConversationSession,
} from "./session";

/**
 * Server-level session-store isolation test.
 *
 * Exercises the REAL `sessions` Map inside session.ts — not a mock.
 * Two different tokens must produce completely independent histories.
 */

const ALICE_TOKEN = "test-alice-token-isolation-001";
const BOB_TOKEN = "test-bob-token-isolation-002";

describe("Server-level session store isolation", () => {
  it("getSession returns distinct objects for different tokens", () => {
    const alice = getSession(ALICE_TOKEN);
    const bob = getSession(BOB_TOKEN);

    expect(alice).not.toBe(bob);
    expect(alice.history).not.toBe(bob.history);
  });

  it("getSession returns the same object for the same token", () => {
    const first = getSession(ALICE_TOKEN);
    const second = getSession(ALICE_TOKEN);

    expect(first).toBe(second);
  });

  it("user messages appended to Alice do not appear in Bob's history", () => {
    const alice = getSession(ALICE_TOKEN);
    const bob = getSession(BOB_TOKEN);

    // Simulate Alice sending a message (what chatStream does internally)
    const aliceMsg = buildUserMessage("Hello from Alice", { route: "/dashboard" });
    alice.history.push({ role: "user", content: aliceMsg });

    // Bob's history must remain empty
    expect(bob.history.length).toBe(0);

    // Alice's history has exactly one entry
    expect(alice.history.length).toBe(1);
    expect(alice.history[0].content).toContain("Alice");
  });

  it("appendAssistantMessage on Alice does not affect Bob", () => {
    const alice = getSession(ALICE_TOKEN);
    const bob = getSession(BOB_TOKEN);

    const aliceLenBefore = alice.history.length;
    const bobLenBefore = bob.history.length;

    appendAssistantMessage(alice, "Hi Alice, welcome to Kapable!");

    // Alice gained one message
    expect(alice.history.length).toBe(aliceLenBefore + 1);
    // Bob is unchanged
    expect(bob.history.length).toBe(bobLenBefore);
  });

  it("full conversation flow — two users interleaved, histories never bleed", () => {
    // Use fresh tokens to avoid state from earlier tests
    const aliceToken = "isolation-full-alice";
    const bobToken = "isolation-full-bob";

    const alice = getSession(aliceToken);
    const bob = getSession(bobToken);

    // Turn 1: Alice asks a question
    const aliceQ1 = buildUserMessage("What are AI Flows?", { route: "/flows" });
    alice.history.push({ role: "user", content: aliceQ1 });
    appendAssistantMessage(alice, "AI Flows let you build automation pipelines.");

    // Turn 1: Bob asks a different question
    const bobQ1 = buildUserMessage("How do I manage my team?", { route: "/settings/team" });
    bob.history.push({ role: "user", content: bobQ1 });
    appendAssistantMessage(bob, "Go to Settings → Team to invite members.");

    // Verify Alice's history
    expect(alice.history.length).toBe(2); // user + assistant
    expect(JSON.stringify(alice.history)).toContain("AI Flows");
    expect(JSON.stringify(alice.history)).not.toContain("manage my team");
    expect(JSON.stringify(alice.history)).not.toContain("invite members");

    // Verify Bob's history
    expect(bob.history.length).toBe(2); // user + assistant
    expect(JSON.stringify(bob.history)).toContain("manage my team");
    expect(JSON.stringify(bob.history)).not.toContain("AI Flows");
    expect(JSON.stringify(bob.history)).not.toContain("automation pipelines");

    // Turn 2: Alice asks a follow-up
    alice.history.push({ role: "user", content: "Can I schedule a flow?" });
    appendAssistantMessage(alice, "Yes, you can set a cron trigger.");

    // Alice now has 4 messages, Bob still has 2
    expect(alice.history.length).toBe(4);
    expect(bob.history.length).toBe(2);

    // Cross-check: Bob's history has zero references to Alice's conversation
    const bobHistoryStr = JSON.stringify(bob.history);
    expect(bobHistoryStr).not.toContain("Alice");
    expect(bobHistoryStr).not.toContain("cron trigger");
    expect(bobHistoryStr).not.toContain("schedule a flow");
  });

  it("appendAssistantMessage with tool_use blocks isolates correctly", () => {
    const aliceToken = "isolation-tools-alice";
    const bobToken = "isolation-tools-bob";

    const alice = getSession(aliceToken);
    const bob = getSession(bobToken);

    // Alice gets a tool-use response (navigate)
    alice.history.push({ role: "user", content: "Take me to flows" });
    appendAssistantMessage(alice, "Navigating you to Flows.", [
      {
        type: "tool_use",
        id: "toolu_alice_001",
        name: "navigate",
        input: { route: "/flows" },
      },
    ]);

    // Alice should have: user msg + assistant (text+tool_use) + synthetic tool_result = 3
    expect(alice.history.length).toBe(3);

    // Bob should have nothing
    expect(bob.history.length).toBe(0);

    // Bob now sends a message
    bob.history.push({ role: "user", content: "Show me dashboard" });
    appendAssistantMessage(bob, "Here is the dashboard.");

    // Bob has 2 messages, Alice still has 3
    expect(bob.history.length).toBe(2);
    expect(alice.history.length).toBe(3);

    // No cross-contamination of tool_use IDs
    const bobStr = JSON.stringify(bob.history);
    expect(bobStr).not.toContain("toolu_alice_001");
    expect(bobStr).not.toContain("/flows");
  });

  it("session count increases with distinct tokens", () => {
    const countBefore = getSessionCount();

    // Create a brand new session
    const uniqueToken = `isolation-count-${Date.now()}`;
    getSession(uniqueToken);

    expect(getSessionCount()).toBe(countBefore + 1);
  });
});
