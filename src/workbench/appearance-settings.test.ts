import { describe, expect, it } from "vitest";

import {
  normalizeFontFamily,
  normalizeZoomLevel,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
} from "./appearance";

describe("appearance settings", () => {
  it("recovers malformed and out-of-range zoom levels", () => {
    expect(normalizeZoomLevel(undefined)).toBe(0);
    expect(normalizeZoomLevel("2")).toBe(0);
    expect(normalizeZoomLevel(Number.NaN)).toBe(0);
    expect(normalizeZoomLevel(1.6)).toBe(2);
    expect(normalizeZoomLevel(-100)).toBe(ZOOM_LEVEL_MIN);
    expect(normalizeZoomLevel(100)).toBe(ZOOM_LEVEL_MAX);
  });

  it("bounds font preferences by UTF-8 bytes and removes controls", () => {
    expect(normalizeFontFamily("JetBrains\nMono\u0000")).toBe("JetBrainsMono");
    expect(
      new TextEncoder().encode(normalizeFontFamily("界".repeat(500))),
    ).toHaveLength(1023);
    expect(normalizeFontFamily({})).toBe("");
  });
});
