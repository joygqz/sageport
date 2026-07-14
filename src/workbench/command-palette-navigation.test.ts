import { describe, expect, it } from "vitest";

import {
  clampPaletteIndex,
  hasPointerMoved,
  movePaletteIndex,
} from "./command-palette-navigation";

describe("command palette navigation", () => {
  it("keeps an empty list at a valid neutral index", () => {
    expect(clampPaletteIndex(-1, 0)).toBe(0);
    expect(movePaletteIndex(0, 1, 0)).toBe(0);
    expect(movePaletteIndex(0, -1, 0)).toBe(0);
  });

  it("clamps stale indexes when the result list changes", () => {
    expect(clampPaletteIndex(-1, 3)).toBe(0);
    expect(clampPaletteIndex(5, 3)).toBe(2);
  });

  it("moves up and down without leaving the result range", () => {
    expect(movePaletteIndex(0, 1, 3)).toBe(1);
    expect(movePaletteIndex(1, -1, 3)).toBe(0);
    expect(movePaletteIndex(2, 1, 3)).toBe(2);
    expect(movePaletteIndex(0, -1, 3)).toBe(0);
  });

  it("ignores pointer events caused by scrolling under a stationary cursor", () => {
    expect(
      hasPointerMoved({ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 0, y: 0 }),
    ).toBe(false);
    expect(hasPointerMoved(null, { x: 10, y: 20 }, { x: 0, y: 0 })).toBe(false);
    expect(
      hasPointerMoved({ x: 10, y: 20 }, { x: 11, y: 20 }, { x: 0, y: 0 }),
    ).toBe(true);
  });
});
