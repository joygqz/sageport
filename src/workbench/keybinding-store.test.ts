import { afterEach, describe, expect, it } from "vitest";

import { effectiveKeybindings } from "./keybinding-registry";
import { useKeybindingStore } from "./keybinding-store";

describe("keybinding store", () => {
  afterEach(() => {
    useKeybindingStore.getState().replaceOverrides({});
  });

  it("replaces only the conflicting shortcut", () => {
    useKeybindingStore
      .getState()
      .replace("view.zoomIn", "mod+shift+-", "view.zoomOut", true);

    const overrides = useKeybindingStore.getState().overrides;
    expect(effectiveKeybindings("view.zoomIn", overrides, true)).toEqual([
      "mod+shift+-",
    ]);
    expect(effectiveKeybindings("view.zoomOut", overrides, true)).toEqual([
      "mod+-",
    ]);
  });

  it("removes conflicts without resetting the target command", () => {
    useKeybindingStore.getState().replaceOverrides({
      "view.zoomIn": null,
    });
    useKeybindingStore
      .getState()
      .removeConflict("mod+shift+-", "view.zoomOut", true);

    const overrides = useKeybindingStore.getState().overrides;
    expect(overrides["view.zoomIn"]).toBeNull();
    expect(effectiveKeybindings("view.zoomOut", overrides, true)).toEqual([
      "mod+-",
    ]);
  });

  it("treats the platform default as unassigned on its own platform", () => {
    useKeybindingStore.getState().set("terminal.copy", "mod+c", true);
    expect(useKeybindingStore.getState().overrides["terminal.copy"]).toBe(
      undefined,
    );

    useKeybindingStore.getState().set("terminal.copy", "mod+c", false);
    expect(useKeybindingStore.getState().overrides["terminal.copy"]).toBe(
      "mod+c",
    );

    useKeybindingStore.getState().set("terminal.copy", "ctrl+shift+c", false);
    expect(useKeybindingStore.getState().overrides["terminal.copy"]).toBe(
      undefined,
    );
  });
});
