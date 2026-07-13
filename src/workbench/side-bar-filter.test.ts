import { describe, expect, it } from "vitest";

import { shouldShowSideBarFilter } from "./side-bar-filter";

describe("shouldShowSideBarFilter", () => {
  it("keeps short lists uncluttered", () => {
    expect(shouldShowSideBarFilter(8, "")).toBe(false);
  });

  it("shows the filter once the list exceeds its threshold", () => {
    expect(shouldShowSideBarFilter(9, "")).toBe(true);
    expect(shouldShowSideBarFilter(4, "", 3)).toBe(true);
  });

  it("keeps an active filter visible as results shrink", () => {
    expect(shouldShowSideBarFilter(0, " production ")).toBe(true);
  });
});
