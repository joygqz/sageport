import { beforeEach, describe, expect, it } from "vitest";

import { useOverlayStore } from "./overlays";

beforeEach(() => {
  useOverlayStore.setState({ overlay: null });
});

describe("settings overlay", () => {
  it("opens at general by default and changes sections in place", () => {
    useOverlayStore.getState().openSettings();
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "settings",
      section: "general",
    });

    useOverlayStore.getState().setSettingsSection("sync");
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "settings",
      section: "sync",
    });

    useOverlayStore.getState().openSettings();
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "settings",
      section: "sync",
    });
  });

  it("does not replace another overlay when only changing a section", () => {
    useOverlayStore.getState().openHostForm("host-1");
    useOverlayStore.getState().setSettingsSection("about");
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "host-form",
      hostId: "host-1",
      groupId: null,
    });
  });

  it("presets the parent group for nested create flows", () => {
    useOverlayStore.getState().openHostForm(undefined, "group-1");
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "host-form",
      hostId: null,
      groupId: "group-1",
    });

    useOverlayStore.getState().openGroupForm(undefined, "group-1");
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "group-form",
      groupId: null,
      parentId: "group-1",
    });
  });
});
