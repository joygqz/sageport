import { describe, expect, it } from "vitest";

import { en } from "./en";
import { zhCN } from "./zh-CN";

function leafPaths(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) =>
      leafPaths(v, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe("locale parity", () => {
  const enKeys = new Set(leafPaths(en));
  const zhKeys = new Set(leafPaths(zhCN));

  it("zh-CN has every en key", () => {
    const missing = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("en has every zh-CN key", () => {
    const extra = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });
});
