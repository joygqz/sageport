import { beforeEach, describe, expect, it } from "vitest";

import { useOverlayStore } from "./overlays";

beforeEach(() => {
  useOverlayStore.setState({ overlay: null });
});

describe("settings overlay", () => {
  it("opens at appearance by default and changes sections in place", () => {
    useOverlayStore.getState().openSettings();
    expect(useOverlayStore.getState().overlay).toEqual({
      type: "settings",
      section: "appearance",
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
    });
  });
});
