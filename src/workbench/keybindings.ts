import { useEffect } from "react";

import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";

/**
 * Global workbench shortcuts. All bindings require the platform modifier
 * (Cmd on macOS, Ctrl elsewhere) so plain keystrokes always reach the
 * focused terminal untouched.
 */
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
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
