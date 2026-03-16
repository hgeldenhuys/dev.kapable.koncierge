import { describe, it, expect } from "bun:test";
import { buildUserMessage, type RouteContext } from "./session";

describe("buildUserMessage", () => {
  it("returns raw message when no context is provided", () => {
    expect(buildUserMessage("hello")).toBe("hello");
  });

  it("returns raw message when context is undefined", () => {
    expect(buildUserMessage("hello", undefined)).toBe("hello");
  });

  it("returns raw message when context has no route or pageTitle", () => {
    expect(buildUserMessage("hello", {})).toBe("hello");
  });

  it("prepends route context when only route is provided", () => {
    const ctx: RouteContext = { route: "/dashboard/pipelines" };
    const result = buildUserMessage("what is this?", ctx);
    expect(result).toBe(
      "[Context: Current route: /dashboard/pipelines]\n\nwhat is this?",
    );
  });

  it("prepends page title context when only pageTitle is provided", () => {
    const ctx: RouteContext = { pageTitle: "Pipeline Manager" };
    const result = buildUserMessage("help me", ctx);
    expect(result).toBe(
      "[Context: Page title: Pipeline Manager]\n\nhelp me",
    );
  });

  it("prepends both route and pageTitle when both are provided", () => {
    const ctx: RouteContext = {
      route: "/settings/team",
      pageTitle: "Team Settings",
    };
    const result = buildUserMessage("how do I add a member?", ctx);
    expect(result).toBe(
      "[Context: Current route: /settings/team, Page title: Team Settings]\n\nhow do I add a member?",
    );
  });

  it("skips empty-string route", () => {
    const ctx: RouteContext = { route: "", pageTitle: "Dashboard" };
    const result = buildUserMessage("hi", ctx);
    expect(result).toBe("[Context: Page title: Dashboard]\n\nhi");
  });

  it("skips empty-string pageTitle", () => {
    const ctx: RouteContext = { route: "/home", pageTitle: "" };
    const result = buildUserMessage("hi", ctx);
    expect(result).toBe("[Context: Current route: /home]\n\nhi");
  });

  it("returns raw message when both route and pageTitle are empty strings", () => {
    const ctx: RouteContext = { route: "", pageTitle: "" };
    expect(buildUserMessage("hi", ctx)).toBe("hi");
  });
});
