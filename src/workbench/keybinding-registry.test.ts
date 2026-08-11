import { describe, expect, it } from "vitest";

import {
  deserializeKeybindingOverrides,
  effectiveKeybindings,
  findKeybinding,
  findKeybindingConflict,
  keybindingDisplayKeys,
  keybindingFromKeyboardEvent,
  keybindingOverrideWithoutConflict,
  parseKeybinding,
  parseKeybindingOverrides,
  platformKeybindingDefaults,
  serializeKeybindingOverrides,
} from "./keybinding-registry";

function key(
  value: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key: value,
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
  } as KeyboardEvent;
}

describe("keybinding registry", () => {
  it("parses supported keybindings and rejects unsafe bare keys", () => {
    expect(parseKeybinding("mod+shift+b")).toMatchObject({
      key: "b",
      mod: true,
      shift: true,
    });
    expect(parseKeybinding("alt+arrowup")).toMatchObject({
      key: "arrowup",
      alt: true,
    });
    expect(parseKeybinding("mod+f12")).toMatchObject({
      key: "f12",
      mod: true,
    });
    expect(parseKeybinding("b")).toBeNull();
    expect(parseKeybinding("shift+b")).toBeNull();
    expect(parseKeybinding("mod+mod+b")).toBeNull();
  });

  it("records platform primary modifiers in a portable form", () => {
    expect(
      keybindingFromKeyboardEvent(key("b", { ctrlKey: true }), false),
    ).toBe("mod+b");
    expect(keybindingFromKeyboardEvent(key("b", { metaKey: true }), true)).toBe(
      "mod+b",
    );
    expect(keybindingFromKeyboardEvent(key("b", { ctrlKey: true }), true)).toBe(
      "ctrl+b",
    );
    expect(keybindingFromKeyboardEvent(key("b"), false)).toBeNull();
  });

  it("matches defaults, custom bindings, and disabled commands", () => {
    expect(findKeybinding(key("b", { ctrlKey: true }), {}, false)).toBe(
      "view.toggleSidebar",
    );
    expect(
      findKeybinding(key("C", { ctrlKey: true, shiftKey: true }), {}, false),
    ).toBe("terminal.copy");
    expect(
      findKeybinding(key("V", { ctrlKey: true, shiftKey: true }), {}, false),
    ).toBe("terminal.paste");
    expect(findKeybinding(key("c", { metaKey: true }), {}, true)).toBe(
      "terminal.copy",
    );
    expect(findKeybinding(key("v", { metaKey: true }), {}, true)).toBe(
      "terminal.paste",
    );
    expect(findKeybinding(key("C", { shiftKey: true }), {}, true)).toBeNull();
    const custom = { "view.toggleSidebar": "mod+shift+s" } as const;
    expect(
      findKeybinding(key("b", { ctrlKey: true }), custom, false),
    ).toBeNull();
    expect(
      findKeybinding(
        key("S", { ctrlKey: true, shiftKey: true }),
        custom,
        false,
      ),
    ).toBe("view.toggleSidebar");
    expect(
      findKeybinding(
        key("b", { ctrlKey: true }),
        { "view.toggleSidebar": null },
        false,
      ),
    ).toBeNull();
  });

  it("detects conflicts using platform modifier semantics", () => {
    expect(findKeybindingConflict("terminal.search", "mod+b", {}, false)).toBe(
      "view.toggleSidebar",
    );
    expect(
      findKeybindingConflict(
        "terminal.search",
        "mod+b",
        { "view.toggleSidebar": null },
        false,
      ),
    ).toBeNull();
    expect(
      keybindingOverrideWithoutConflict(
        "view.zoomOut",
        "mod+shift+-",
        {},
        true,
      ),
    ).toBe("mod+-");
  });

  it("serializes only known, valid overrides in registry order", () => {
    const overrides = parseKeybindingOverrides({
      "terminal.search": "mod+shift+f",
      "view.toggleSidebar": null,
    });
    expect(overrides).not.toBeNull();
    const serialized = serializeKeybindingOverrides(overrides ?? {});
    expect(serialized).toBe(
      '{"terminal.search":"mod+shift+f","view.toggleSidebar":null}',
    );
    expect(deserializeKeybindingOverrides(serialized)).toEqual(overrides);
    expect(parseKeybindingOverrides({ unknown: "mod+k" })).toBeNull();
    expect(
      effectiveKeybindings("view.toggleSidebar", overrides ?? {}, false),
    ).toEqual([]);
    expect(
      keybindingDisplayKeys("terminal.search", overrides ?? {}, false),
    ).toEqual(["mod", "shift", "f"]);
    expect(
      keybindingDisplayKeys("view.toggleSidebar", overrides ?? {}, false),
    ).toBeUndefined();
  });

  it("uses platform-specific default bindings for copy and paste", () => {
    expect(platformKeybindingDefaults("terminal.copy", false)).toEqual([
      "ctrl+shift+c",
    ]);
    expect(platformKeybindingDefaults("terminal.copy", true)).toEqual([
      "mod+c",
    ]);
    expect(platformKeybindingDefaults("terminal.paste", true)).toEqual([
      "mod+v",
    ]);
    expect(effectiveKeybindings("terminal.copy", {}, true)).toEqual(["mod+c"]);
    expect(effectiveKeybindings("terminal.paste", {}, false)).toEqual([
      "ctrl+shift+v",
    ]);
    expect(keybindingDisplayKeys("terminal.copy", {}, true)).toEqual([
      "mod",
      "c",
    ]);
    expect(keybindingDisplayKeys("terminal.copy", {}, false)).toEqual([
      "ctrl",
      "shift",
      "c",
    ]);
  });
});
