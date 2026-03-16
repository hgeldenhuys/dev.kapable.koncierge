import { describe, it, expect, mock, beforeEach } from "bun:test";
import { executeUiCall, type DriverLike } from "./useToolCallExecutor";
import type { ToolCall } from "./parseToolCalls";

/**
 * Tests for the executeUiCall function from useToolCallExecutor.
 *
 * We test the pure function directly rather than the React hook,
 * since the hook is a thin wrapper around useNavigate + executeUiCall.
 * This avoids needing a full React + Router test harness while still
 * covering the core dispatch logic.
 */

function createMockDriver(): DriverLike & {
  highlightCalls: Array<Parameters<DriverLike["highlight"]>[0]>;
  destroyCalls: number;
} {
  const highlightCalls: Array<Parameters<DriverLike["highlight"]>[0]> = [];
  let destroyCalls = 0;

  return {
    highlightCalls,
    get destroyCalls() {
      return destroyCalls;
    },
    highlight(config) {
      highlightCalls.push(config);
    },
    destroy() {
      destroyCalls++;
    },
  };
}

describe("executeUiCall", () => {
  // ── Highlight ──────────────────────────────────────────────────

  it("calls driver.highlight for highlight tool call", () => {
    const driver = createMockDriver();
    const tc: ToolCall = {
      tool: "highlight",
      selector: "#sidebar-projects",
      message: "Click here",
    };

    executeUiCall(tc, driver);

    expect(driver.destroyCalls).toBe(1);
    expect(driver.highlightCalls).toHaveLength(1);
    expect(driver.highlightCalls[0]).toEqual({
      element: "#sidebar-projects",
      popover: { description: "Click here" },
    });
  });

  it("calls driver.highlight without popover when no message", () => {
    const driver = createMockDriver();
    const tc: ToolCall = {
      tool: "highlight",
      selector: ".create-btn",
    };

    executeUiCall(tc, driver);

    expect(driver.highlightCalls).toHaveLength(1);
    expect(driver.highlightCalls[0]).toEqual({
      element: ".create-btn",
      popover: undefined,
    });
  });

  // ── Tooltip ────────────────────────────────────────────────────

  it("calls driver.highlight with popover for tooltip tool call", () => {
    const driver = createMockDriver();
    const tc: ToolCall = {
      tool: "tooltip",
      selector: ".settings-btn",
      message: "Open settings here",
    };

    executeUiCall(tc, driver);

    expect(driver.destroyCalls).toBe(1);
    expect(driver.highlightCalls).toHaveLength(1);
    expect(driver.highlightCalls[0]).toEqual({
      element: ".settings-btn",
      popover: { description: "Open settings here" },
    });
  });

  // ── ShowSection ────────────────────────────────────────────────

  it("does not throw for showSection when element is missing", () => {
    // In test env there's no DOM, so querySelector returns null.
    // The function should handle this gracefully.
    const tc: ToolCall = {
      tool: "showSection",
      section: "getting-started",
    };

    expect(() => executeUiCall(tc, null)).not.toThrow();
  });

  // ── No driver ──────────────────────────────────────────────────

  it("is a no-op for highlight when driver is null", () => {
    const tc: ToolCall = {
      tool: "highlight",
      selector: "#sidebar",
      message: "Look here",
    };

    // Should not throw
    expect(() => executeUiCall(tc, null)).not.toThrow();
  });

  it("is a no-op for tooltip when driver is undefined", () => {
    const tc: ToolCall = {
      tool: "tooltip",
      selector: ".btn",
      message: "Click me",
    };

    expect(() => executeUiCall(tc, undefined)).not.toThrow();
  });

  // ── Navigate is handled by the hook, not executeUiCall ─────────

  it("does nothing for navigate tool calls (handled by hook)", () => {
    const driver = createMockDriver();
    const tc: ToolCall = { tool: "navigate", route: "/projects" };

    // navigate is not a UI call — executeUiCall should be a no-op
    executeUiCall(tc, driver);

    expect(driver.highlightCalls).toHaveLength(0);
    expect(driver.destroyCalls).toBe(0);
  });
});
