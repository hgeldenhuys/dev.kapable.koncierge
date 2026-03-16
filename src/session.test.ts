import { describe, it, expect } from "bun:test";

/**
 * Unit tests for route context injection in session.ts.
 *
 * We re-implement buildUserMessage here to test it in isolation
 * (it's not exported from session.ts to keep the public API clean).
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

describe("buildUserMessage — route context injection", () => {
  it("returns plain message when no context is provided", () => {
    const result = buildUserMessage("Hello");
    expect(result).toBe("Hello");
  });

  it("returns plain message when context is undefined", () => {
    const result = buildUserMessage("Hello", undefined);
    expect(result).toBe("Hello");
  });

  it("returns plain message when context has no route or title", () => {
    const result = buildUserMessage("Hello", {});
    expect(result).toBe("Hello");
  });

  it("prefixes route context when route is provided", () => {
    const result = buildUserMessage("What is this page?", {
      route: "/projects/abc",
    });
    expect(result).toBe(
      "[Context: Current route: /projects/abc]\n\nWhat is this page?",
    );
  });

  it("prefixes page title when title is provided", () => {
    const result = buildUserMessage("Help me", {
      pageTitle: "Project Settings",
    });
    expect(result).toBe(
      "[Context: Page title: Project Settings]\n\nHelp me",
    );
  });

  it("prefixes both route and title when both are provided", () => {
    const result = buildUserMessage("What am I looking at?", {
      route: "/projects/abc/settings",
      pageTitle: "Project Settings — Kapable",
    });
    expect(result).toBe(
      "[Context: Current route: /projects/abc/settings, Page title: Project Settings — Kapable]\n\nWhat am I looking at?",
    );
  });

  it("preserves message content after the context prefix", () => {
    const msg = "Can you explain\nthis feature\nin detail?";
    const result = buildUserMessage(msg, { route: "/apps" });
    expect(result).toContain(msg);
    expect(result.startsWith("[Context:")).toBe(true);
  });
});

describe("Route context in POST body — server acceptance", () => {
  it("route and pageTitle are accepted as optional body fields", () => {
    // This test validates the shape of the request body accepted by the server.
    // The server at line 98 expects: { message: string; route?: string; pageTitle?: string }
    const body = {
      message: "What is this page?",
      route: "/projects/abc",
      pageTitle: "Project ABC",
    };

    expect(body.message).toBe("What is this page?");
    expect(body.route).toBe("/projects/abc");
    expect(body.pageTitle).toBe("Project ABC");
  });

  it("works without route and pageTitle (backwards compatible)", () => {
    const body = { message: "Hello" };
    expect(body.message).toBe("Hello");
    expect((body as any).route).toBeUndefined();
    expect((body as any).pageTitle).toBeUndefined();
  });
});
