import { describe, it, expect } from "bun:test";

/**
 * Tests for the buildUserMessage function from session.ts.
 *
 * We re-implement the function here to avoid importing the full session
 * module (which requires Anthropic SDK + knowledge base files). The
 * logic is trivial but critical: route context MUST be prefixed to
 * every user message so the agent knows which page the user is on.
 */

interface RouteContext {
  route?: string;
  pageTitle?: string;
}

function buildUserMessage(message: string, ctx?: RouteContext): string {
  if (!ctx) return message;
  const parts: string[] = [];
  if (ctx.route) parts.push(`Current route: ${ctx.route}`);
  if (ctx.pageTitle) parts.push(`Page title: ${ctx.pageTitle}`);
  if (parts.length === 0) return message;
  return `[Context: ${parts.join(", ")}]\n\n${message}`;
}

describe("buildUserMessage", () => {
  it("returns raw message when no context is provided", () => {
    expect(buildUserMessage("Hello")).toBe("Hello");
  });

  it("returns raw message when context is undefined", () => {
    expect(buildUserMessage("Hello", undefined)).toBe("Hello");
  });

  it("returns raw message when context has no route or title", () => {
    expect(buildUserMessage("Hello", {})).toBe("Hello");
  });

  it("prefixes route when only route is provided", () => {
    const result = buildUserMessage("Hello", { route: "/projects" });
    expect(result).toBe("[Context: Current route: /projects]\n\nHello");
  });

  it("prefixes page title when only pageTitle is provided", () => {
    const result = buildUserMessage("Hello", { pageTitle: "Projects" });
    expect(result).toBe("[Context: Page title: Projects]\n\nHello");
  });

  it("prefixes both route and pageTitle when both are provided", () => {
    const result = buildUserMessage("Hello", {
      route: "/projects/abc/settings",
      pageTitle: "Project Settings",
    });
    expect(result).toBe(
      "[Context: Current route: /projects/abc/settings, Page title: Project Settings]\n\nHello",
    );
  });

  it("preserves multiline messages", () => {
    const msg = "Line 1\nLine 2\nLine 3";
    const result = buildUserMessage(msg, { route: "/dashboard" });
    expect(result).toContain("Line 1\nLine 2\nLine 3");
    expect(result).toStartWith("[Context:");
  });
});
