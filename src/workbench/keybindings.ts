import { useEffect } from "react";

import { useBroadcastStore } from "@/features/terminal/broadcast";
import { useTerminalSearch } from "@/features/terminal/search";
import { IS_MACOS } from "@/lib/platform";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";
import { copyActivePane, pasteActivePane } from "./commands";
import { useZoomStore } from "./zoom";
import { findKeybinding, type KeybindingId } from "./keybinding-registry";
import { useKeybindingStore } from "./keybinding-store";

function runKeybinding(id: KeybindingId): void {
  const layout = useLayoutStore.getState();
  const overlays = useOverlayStore.getState();
  const tabs = useTabsStore.getState();

  if (id === "palette.quick") {
    overlays.openPalette("quick");
  } else if (id === "palette.commands") {
    overlays.openPalette("commands");
  } else if (id.startsWith("tab.activate.")) {
    tabs.activateAt(Number(id.slice(-1)) - 1);
  } else if (id === "host.new") {
    overlays.openHostForm();
  } else if (id === "settings.open") {
    overlays.openSettings();
  } else if (id === "view.toggleSidebar") {
    layout.toggleSidebar();
  } else if (id === "terminal.toggleBroadcast") {
    useBroadcastStore.getState().toggle();
  } else if (id === "terminal.newLocal") {
    tabs.openLocalTerminal();
  } else if (id === "view.togglePanel") {
    layout.togglePanel();
  } else if (id === "view.toggleAssistant") {
    layout.toggleAux();
  } else if (id === "tab.close") {
    if (overlays.overlay) {
      overlays.close();
      return;
    }
    const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
    if (active?.kind === "terminal" && active.panes.length > 1) {
      tabs.closePane(active.activePaneId);
    } else if (tabs.activeId) {
      tabs.close(tabs.activeId);
    }
  } else if (id === "tab.previous" || id === "tab.next") {
    tabs.activateNext(id === "tab.next" ? 1 : -1);
  } else if (
    id === "terminal.focusPreviousPane" ||
    id === "terminal.focusNextPane"
  ) {
    const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
    if (active?.kind === "terminal" && active.panes.length > 1) {
      tabs.focusPaneNext(id === "terminal.focusNextPane" ? 1 : -1);
    }
  } else if (id === "terminal.splitRight" || id === "terminal.splitDown") {
    const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
    if (active?.kind === "terminal") {
      tabs.splitPane(
        active.activePaneId,
        id === "terminal.splitDown" ? "down" : "right",
      );
    }
  } else if (id === "terminal.search") {
    const active = tabs.tabs.find((tab) => tab.id === tabs.activeId);
    if (active?.kind === "terminal") {
      useTerminalSearch.getState().open(active.activePaneId);
    }
  } else if (id === "terminal.copy") {
    copyActivePane();
  } else if (id === "terminal.paste") {
    pasteActivePane();
  } else if (id === "view.zoomIn") {
    useZoomStore.getState().zoomIn();
  } else if (id === "view.zoomOut") {
    useZoomStore.getState().zoomOut();
  } else if (id === "view.zoomReset") {
    useZoomStore.getState().resetZoom();
  }
}

export function useKeybindings() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const id = findKeybinding(
        e,
        useKeybindingStore.getState().overrides,
        IS_MACOS,
      );
      if (!id) return;
      e.preventDefault();
      runKeybinding(id);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
