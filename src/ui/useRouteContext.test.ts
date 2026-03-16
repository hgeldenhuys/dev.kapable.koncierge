import { describe, it, expect } from "bun:test";

// Test the route context module exports and types
describe("useRouteContext module", () => {
  it("exports useRouteContext function", async () => {
    const mod = await import("./useRouteContext");
    expect(mod.useRouteContext).toBeDefined();
    expect(typeof mod.useRouteContext).toBe("function");
  });

  it("exports default as useRouteContext", async () => {
    const mod = await import("./useRouteContext");
    expect(mod.default).toBe(mod.useRouteContext);
  });
});

// Test the barrel export includes useRouteContext
describe("barrel export includes useRouteContext", () => {
  it("re-exports useRouteContext from index", async () => {
    const mod = await import("./index");
    expect(mod.useRouteContext).toBeDefined();
    expect(typeof mod.useRouteContext).toBe("function");
  });
});
