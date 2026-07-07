import { useEffect } from "react";

import { useTerminalSearch } from "@/features/terminal/search";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";
import { useZoomStore } from "./zoom";

export function useKeybindings() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      const layout = useLayoutStore.getState();
      const overlays = useOverlayStore.getState();
      const tabs = useTabsStore.getState();
      const key = e.key.toLowerCase();

      const run = (action: () => void) => {
        e.preventDefault();
        action();
      };

      if (key === "p") {
        run(() => overlays.openPalette(e.shiftKey ? "commands" : "quick"));
      } else if (key === "n" && !e.shiftKey) {
        run(() => overlays.openHostForm());
      } else if (key === ",") {
        run(() => tabs.openSettings());
      } else if (key === "b" && !e.shiftKey) {
        run(() => layout.toggleSidebar());
      } else if (key === "j" && !e.shiftKey) {
        run(() => layout.togglePanel());
      } else if (key === "l" && !e.shiftKey) {
        run(() => layout.toggleAux());
      } else if (key === "w" && !e.shiftKey) {
        run(() => {
          if (tabs.activeId) tabs.close(tabs.activeId);
        });
      } else if (e.shiftKey && (key === "[" || key === "]")) {
        run(() => tabs.activateNext(key === "]" ? 1 : -1));
      } else if (key === "f" && !e.shiftKey) {
        const active = tabs.tabs.find((t) => t.id === tabs.activeId);
        if (active?.kind === "terminal") {
          run(() => useTerminalSearch.getState().open(active.id));
        }
      } else if (key === "=" || key === "+") {
        run(() => useZoomStore.getState().zoomIn());
      } else if (key === "-" || key === "_") {
        run(() => useZoomStore.getState().zoomOut());
      } else if (key === "0") {
        run(() => useZoomStore.getState().resetZoom());
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
