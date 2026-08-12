import { describe, expect, it } from "vitest";

import { clipboardShortcutShouldDefer, isWorkbenchShortcut } from "./shortcuts";

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
    expect(shortcut(key("[", { code: "BracketLeft" }))).toBe(true);
    expect(shortcut(key("]", { code: "BracketRight" }))).toBe(true);
    expect(shortcut(key("\\", { code: "Backslash" }))).toBe(true);
    expect(shortcut(key("|", { shiftKey: true, code: "Backslash" }))).toBe(
      true,
    );
    expect(shortcut(key("+", { shiftKey: true }))).toBe(true);
    expect(shortcut(key("1"))).toBe(true);
    expect(shortcut(key("9"))).toBe(true);
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
    expect(shortcut(key("1", { shiftKey: true }))).toBe(false);
    expect(shortcut(key("b", { altKey: true }))).toBe(false);
    expect(shortcut(key("b", { ctrlKey: false }))).toBe(false);
  });

  it("honors custom and disabled shortcuts", () => {
    expect(
      isWorkbenchShortcut(key("b"), false, {
        "view.toggleSidebar": null,
      }),
    ).toBe(false);
    expect(
      isWorkbenchShortcut(key("S", { shiftKey: true }), false, {
        "view.toggleSidebar": "mod+shift+s",
      }),
    ).toBe(true);
  });
});

describe("clipboardShortcutShouldDefer", () => {
  const input = {
    tagName: "INPUT",
    closest: () => null,
  } as unknown as Element;
  const terminalTextarea = {
    tagName: "TEXTAREA",
    closest: (selector: string) =>
      selector === ".xterm" ? ({} as Element) : null,
  } as unknown as Element;
  const body = { tagName: "BODY", closest: () => null } as unknown as Element;

  it("defers copy and paste while an overlay is open", () => {
    expect(clipboardShortcutShouldDefer("terminal.copy", true, input)).toBe(
      true,
    );
    expect(clipboardShortcutShouldDefer("terminal.paste", true, body)).toBe(
      true,
    );
  });

  it("defers when focus is in a non-terminal editable field", () => {
    expect(clipboardShortcutShouldDefer("terminal.copy", false, input)).toBe(
      true,
    );
  });

  it("keeps the shortcut when the terminal is focused", () => {
    expect(
      clipboardShortcutShouldDefer("terminal.paste", false, terminalTextarea),
    ).toBe(false);
  });

  it("defers copy when page text is selected", () => {
    expect(
      clipboardShortcutShouldDefer("terminal.copy", false, body, true),
    ).toBe(true);
    expect(
      clipboardShortcutShouldDefer("terminal.paste", false, body, true),
    ).toBe(false);
  });

  it("does not defer other commands or non-editable focus", () => {
    expect(
      clipboardShortcutShouldDefer("view.toggleSidebar", false, input),
    ).toBe(false);
    expect(clipboardShortcutShouldDefer("terminal.copy", false, body)).toBe(
      false,
    );
  });
});
