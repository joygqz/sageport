import { describe, expect, it } from "vitest";

import { cn, formatBytes, isValidRegex } from "./utils";

describe("cn", () => {
  it("merges conditional classes", () => {
    const hidden = [] as string[];
    expect(cn("a", hidden.length > 0 && "b", "c")).toBe("a c");
  });

  it("dedupes conflicting tailwind utilities", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});

describe("isValidRegex", () => {
  it("accepts valid regular expressions, including an empty one", () => {
    expect(isValidRegex("")).toBe(true);
    expect(isValidRegex("(foo|bar)+")).toBe(true);
    expect(isValidRegex("[a-z]\\d{2}")).toBe(true);
  });

  it("rejects invalid regular expressions", () => {
    expect(isValidRegex("(")).toBe(false);
    expect(isValidRegex("[a-z")).toBe(false);
    expect(isValidRegex("foo\\")).toBe(false);
    expect(isValidRegex("\\8")).toBe(false);
  });
});

describe("formatBytes", () => {
  it("handles zero and invalid input", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });

  it("formats whole bytes without decimals", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats larger units with one decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 4 * 2.25)).toBe("2.3 TB");
  });

  it("clamps beyond the largest unit", () => {
    expect(formatBytes(1024 ** 5)).toBe("1024.0 TB");
  });
});
