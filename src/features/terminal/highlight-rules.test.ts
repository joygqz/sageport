import { describe, expect, it } from "vitest";

import {
  findLiteralMatches,
  normalizeHighlightRules,
  parseHighlightRules,
} from "./highlight-rules";

describe("terminal highlight rules", () => {
  it("finds non-overlapping literal matches", () => {
    expect(findLiteralMatches("error ERROR terror", "error", false)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 13, end: 18 },
    ]);
    expect(findLiteralMatches("error ERROR", "error", true)).toEqual([
      { start: 0, end: 5 },
    ]);
  });

  it("drops malformed rules and normalizes colors", () => {
    expect(
      normalizeHighlightRules([
        {
          id: "rule-1",
          pattern: "warn",
          caseSensitive: false,
          foreground: "#AABBCC",
          background: null,
          enabled: true,
        },
        { id: "rule-2", pattern: "", foreground: "#ffffff" },
        { id: "rule-3", pattern: "error", foreground: "red" },
      ]),
    ).toEqual([
      {
        id: "rule-1",
        pattern: "warn",
        caseSensitive: false,
        foreground: "#aabbcc",
        background: null,
        enabled: true,
      },
    ]);
  });

  it("handles invalid persisted JSON", () => {
    expect(parseHighlightRules("not json")).toEqual([]);
  });
});
