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

const shortcut = (event: KeyboardEvent) => isWorkbenchShortcut(event, false);

describe("isWorkbenchShortcut", () => {
  it("recognizes shortcuts that must not be sent to a terminal", () => {
    expect(shortcut(key("b"))).toBe(true);
    expect(shortcut(key("B", { shiftKey: true }))).toBe(true);
    expect(shortcut(key("T", { shiftKey: true }))).toBe(true);
    expect(shortcut(key("F"))).toBe(true);
    expect(shortcut(key("{", { shiftKey: true, code: "BracketLeft" }))).toBe(
      true,
    );
    expect(shortcut(key("+", { shiftKey: true }))).toBe(true);
  });

  it("uses Command on macOS without swallowing terminal Control keys", () => {
    expect(isWorkbenchShortcut(key("b"), true)).toBe(false);
    expect(
      isWorkbenchShortcut(key("b", { ctrlKey: false, metaKey: true }), true),
    ).toBe(true);
    expect(
      isWorkbenchShortcut(key("b", { ctrlKey: true, metaKey: true }), true),
    ).toBe(false);
  });

  it("does not treat the Windows key as Ctrl on other platforms", () => {
    expect(
      isWorkbenchShortcut(key("b", { ctrlKey: false, metaKey: true }), false),
    ).toBe(false);
  });

  it("allows terminal control keys and unsupported modifier variants", () => {
    expect(shortcut(key("c"))).toBe(false);
    expect(shortcut(key("n", { shiftKey: true }))).toBe(false);
    expect(shortcut(key("b", { altKey: true }))).toBe(false);
    expect(shortcut(key("b", { ctrlKey: false }))).toBe(false);
  });
});
