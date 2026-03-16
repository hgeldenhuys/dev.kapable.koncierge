import { describe, it, expect } from "bun:test";
import { humanisePathname, isGenericTitle } from "./useRouteContext";

describe("humanisePathname", () => {
  it("returns 'Dashboard' for root path", () => {
    expect(humanisePathname("/")).toBe("Dashboard");
  });

  it("capitalises single segment", () => {
    expect(humanisePathname("/projects")).toBe("Projects");
  });

  it("joins multiple segments with /", () => {
    expect(humanisePathname("/projects/settings")).toBe("Projects / Settings");
  });

  it("strips UUID segments", () => {
    expect(humanisePathname("/projects/f3e0ca8b-ce81-40bc-b362-c052d1fbaa08/settings"))
      .toBe("Projects / Settings");
  });

  it("strips numeric ID segments", () => {
    expect(humanisePathname("/projects/12345/settings")).toBe("Projects / Settings");
  });

  it("converts hyphens to spaces", () => {
    expect(humanisePathname("/api-keys")).toBe("Api keys");
  });

  it("handles deeply nested routes", () => {
    expect(humanisePathname("/org/teams/members")).toBe("Org / Teams / Members");
  });

  it("handles trailing slash", () => {
    expect(humanisePathname("/projects/")).toBe("Projects");
  });
});

describe("isGenericTitle", () => {
  it("treats empty string as generic", () => {
    expect(isGenericTitle("")).toBe(true);
  });

  it("treats 'Kapable' as generic", () => {
    expect(isGenericTitle("Kapable")).toBe(true);
  });

  it("treats 'Kapable Console' as generic (case-insensitive)", () => {
    expect(isGenericTitle("Kapable Console")).toBe(true);
  });

  it("treats specific page titles as non-generic", () => {
    expect(isGenericTitle("Projects — Kapable Console")).toBe(false);
  });

  it("treats arbitrary titles as non-generic", () => {
    expect(isGenericTitle("My Cool Page")).toBe(false);
  });
});
