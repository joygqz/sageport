import { describe, expect, it } from "vitest";

import { isWorkbenchShortcut } from "./shortcuts";

function key(
  value: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key: value,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
  } as KeyboardEvent;
}

describe("isWorkbenchShortcut", () => {
  it("recognizes shortcuts that must not be sent to a terminal", () => {
    expect(isWorkbenchShortcut(key("b"))).toBe(true);
    expect(isWorkbenchShortcut(key("B", { shiftKey: true }))).toBe(true);
    expect(isWorkbenchShortcut(key("T", { shiftKey: true }))).toBe(true);
    expect(isWorkbenchShortcut(key("F"))).toBe(true);
    expect(
      isWorkbenchShortcut(key("{", { shiftKey: true, code: "BracketLeft" })),
    ).toBe(true);
    expect(isWorkbenchShortcut(key("+", { shiftKey: true }))).toBe(true);
  });

  it("allows terminal control keys and unsupported modifier variants", () => {
    expect(isWorkbenchShortcut(key("c"))).toBe(false);
    expect(isWorkbenchShortcut(key("n", { shiftKey: true }))).toBe(false);
    expect(isWorkbenchShortcut(key("b", { altKey: true }))).toBe(false);
    expect(isWorkbenchShortcut(key("b", { ctrlKey: false }))).toBe(false);
  });
});
