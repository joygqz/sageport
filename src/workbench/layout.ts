import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useZoomStore, zoomFactor } from "./zoom";

/**
 * Workbench layout state: which activity view the side bar shows, and the
 * visibility/size of each dockable region. Persisted so the window comes
 * back exactly as the user left it.
 *
 * Sizing follows VSCode's model: every part has a hard minimum (so its
 * content never deforms) and no fixed maximum — a part may grow until the
 * editor and the other parts are squeezed down to their own minimums. Sizes
 * re-clamp on window resize and zoom change instead of overflowing.
 *
 * All constants are CSS px at zoom level 0. The UI zooms by scaling the root
 * font-size, so every constraint is multiplied by the same zoom factor
 * before use — a minimum then always guarantees the same amount of content,
 * not the same amount of screen.
 */

export type Activity = "hosts" | "credentials" | "snippets";

export const SIDEBAR_MIN = 170;
export const PANEL_MIN = 100;
export const AUX_MIN = 240;

/** Fixed chrome that competes with the resizable parts for space. */
const ACTIVITY_BAR_W = 45; // w-12 = 3rem
const TITLE_BAR_H = 33.75; // h-9 = 2.25rem
const STATUS_BAR_H = 22.5; // h-6 = 1.5rem
/** The editor area never gives up more than this. */
const EDITOR_MIN_W = 220;
const EDITOR_MIN_H = 70;

/** Live zoom factor scaling every rem-based size in the app. */
const uiScale = () => zoomFactor(useZoomStore.getState().level);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

interface LayoutState {
  activity: Activity;
  sidebarVisible: boolean;
  sidebarWidth: number;
  /** Bottom panel (file transfer). */
  panelVisible: boolean;
  panelHeight: number;
  /** Right auxiliary bar (AI assistant). */
  auxVisible: boolean;
  auxWidth: number;

  /** Select an activity; reselecting the current one toggles the side bar. */
  selectActivity: (activity: Activity) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  togglePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  setPanelHeight: (height: number) => void;
  toggleAux: () => void;
  setAuxWidth: (width: number) => void;
  /** Re-clamp every part to the current window; called on window resize. */
  clampToViewport: () => void;
}

/** Horizontal space the editor + the *other* horizontal part leave over. */
function maxWidthFor(other: number): number {
  return Math.max(
    0,
    window.innerWidth - (ACTIVITY_BAR_W + EDITOR_MIN_W) * uiScale() - other,
  );
}

function clampSidebar(width: number, s: { auxVisible: boolean; auxWidth: number }) {
  const min = SIDEBAR_MIN * uiScale();
  const roomMax = maxWidthFor(s.auxVisible ? s.auxWidth : 0);
  return clamp(width, min, Math.max(min, roomMax));
}

function clampAux(width: number, s: { sidebarVisible: boolean; sidebarWidth: number }) {
  const min = AUX_MIN * uiScale();
  const roomMax = maxWidthFor(s.sidebarVisible ? s.sidebarWidth : 0);
  return clamp(width, min, Math.max(min, roomMax));
}

function clampPanel(height: number) {
  const min = PANEL_MIN * uiScale();
  const roomMax =
    window.innerHeight -
    (TITLE_BAR_H + STATUS_BAR_H + EDITOR_MIN_H) * uiScale();
  return clamp(height, min, Math.max(min, roomMax));
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      activity: "hosts",
      sidebarVisible: true,
      sidebarWidth: 260,
      panelVisible: false,
      panelHeight: 320,
      auxVisible: false,
      auxWidth: 380,

      selectActivity: (activity) =>
        set((s) =>
          s.activity === activity
            ? { sidebarVisible: !s.sidebarVisible }
            : { activity, sidebarVisible: true },
        ),
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarWidth: (width) =>
        set((s) => ({ sidebarWidth: clampSidebar(width, s) })),
      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
      setPanelVisible: (visible) => set({ panelVisible: visible }),
      setPanelHeight: (height) => set({ panelHeight: clampPanel(height) }),
      toggleAux: () => set((s) => ({ auxVisible: !s.auxVisible })),
      setAuxWidth: (width) => set((s) => ({ auxWidth: clampAux(width, s) })),

      clampToViewport: () => {
        const s = get();
        set({
          sidebarWidth: clampSidebar(s.sidebarWidth, s),
          auxWidth: clampAux(s.auxWidth, s),
          panelHeight: clampPanel(s.panelHeight),
        });
      },
    }),
    { name: "sageport.workbench" },
  ),
);
