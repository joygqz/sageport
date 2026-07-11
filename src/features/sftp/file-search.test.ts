import { describe, expect, it } from "vitest";

import { expandReplacement } from "./file-search";

describe("expandReplacement", () => {
  it("expands the full match and numbered captures", () => {
    const captures = ["first last", "first", "last"];

    expect(expandReplacement("$& / $0 / $2, $1", captures, false)).toBe(
      "first last / first last / last, first",
    );
  });

  it("supports captures up to 99", () => {
    const captures = Array.from({ length: 100 }, (_, index) => `c${index}`);

    expect(expandReplacement("$1-$10-$99", captures, false)).toBe("c1-c10-c99");
  });

  it("keeps references to missing captures literal", () => {
    expect(expandReplacement("$1 $2 $12 $99", ["match", "one"], false)).toBe(
      "one $2 $12 $99",
    );
  });

  it("turns an unmatched existing capture into an empty string", () => {
    const captures = [
      "match",
      undefined,
      "two",
    ] as unknown as readonly string[];

    expect(expandReplacement("$1-$2", captures, false)).toBe("-two");
  });

  it("expands dollar and backslash escape sequences", () => {
    expect(
      expandReplacement("$$1\\n$1\\t\\\\done", ["match", "capture"], false),
    ).toBe("$1\ncapture\t\\done");
  });

  it("keeps unknown and trailing backslash escapes literal", () => {
    expect(expandReplacement("\\x-$1-\\", ["match", "capture"], false)).toBe(
      "\\x-capture-\\",
    );
  });

  it("treats a non-regex replacement as ordinary text", () => {
    expect(expandReplacement("$1\\n$$", null, false)).toBe("$1\\n$$");
  });

  it("preserves uppercase, lowercase, and capitalized match casing", () => {
    expect(expandReplacement("next value", ["CURRENT"], true)).toBe(
      "NEXT VALUE",
    );
    expect(expandReplacement("Next Value", ["current"], true)).toBe(
      "next value",
    );
    expect(expandReplacement("next VALUE", ["Current"], true)).toBe(
      "Next value",
    );
  });

  it("uses sourceText to preserve case for a plain-text replacement", () => {
    expect(expandReplacement("next", null, true, "CURRENT")).toBe("NEXT");
    expect(expandReplacement("NEXT", null, true, "current")).toBe("next");
    expect(expandReplacement("next VALUE", null, true, "Current")).toBe(
      "Next value",
    );
  });

  it("leaves casing unchanged without a usable source", () => {
    expect(expandReplacement("Next", null, true)).toBe("Next");
    expect(expandReplacement("Next", [], true)).toBe("Next");
    expect(expandReplacement("Next", ["123"], true)).toBe("Next");
    expect(expandReplacement("Next", ["mIxEd"], true)).toBe("Next");
  });
});
