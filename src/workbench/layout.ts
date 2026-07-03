import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Workbench layout state: which activity view the side bar shows, and the
 * visibility/size of each dockable region. Persisted so the window comes
 * back exactly as the user left it.
 *
 * Sizing follows VSCode's model: every part has a hard minimum (so its
 * content never deforms), and maximums are computed against the live window
 * size so the editor always keeps a usable minimum area. Sizes re-clamp on
 * window resize instead of overflowing.
 */

export type Activity = "hosts" | "credentials" | "snippets";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const PANEL_MIN = 160;
export const AUX_MIN = 300;
export const AUX_MAX = 640;

/** Fixed chrome that competes with the resizable parts for space. */
const ACTIVITY_BAR_W = 48;
const TITLE_BAR_H = 34;
const STATUS_BAR_H = 24;
/** The editor area never gives up more than this. */
const EDITOR_MIN_W = 300;
const EDITOR_MIN_H = 140;

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
  return Math.max(0, window.innerWidth - ACTIVITY_BAR_W - EDITOR_MIN_W - other);
}

function clampSidebar(width: number, s: { auxVisible: boolean; auxWidth: number }) {
  const roomMax = maxWidthFor(s.auxVisible ? s.auxWidth : 0);
  return clamp(width, SIDEBAR_MIN, Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, roomMax)));
}

function clampAux(width: number, s: { sidebarVisible: boolean; sidebarWidth: number }) {
  const roomMax = maxWidthFor(s.sidebarVisible ? s.sidebarWidth : 0);
  return clamp(width, AUX_MIN, Math.max(AUX_MIN, Math.min(AUX_MAX, roomMax)));
}

function clampPanel(height: number) {
  const roomMax = window.innerHeight - TITLE_BAR_H - STATUS_BAR_H - EDITOR_MIN_H;
  return clamp(height, PANEL_MIN, Math.max(PANEL_MIN, roomMax));
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
