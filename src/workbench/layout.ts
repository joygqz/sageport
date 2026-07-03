import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Workbench layout state: which activity view the side bar shows, and the
 * visibility/size of each dockable region. Persisted so the window comes
 * back exactly as the user left it.
 */

export type Activity = "hosts" | "credentials" | "snippets";

export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const PANEL_MIN = 240;
export const AUX_MIN = 300;
export const AUX_MAX = 640;

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
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
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
        set({ sidebarWidth: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) }),
      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
      setPanelVisible: (visible) => set({ panelVisible: visible }),
      setPanelHeight: (height) =>
        set({
          panelHeight: clamp(height, PANEL_MIN, window.innerHeight * 0.7),
        }),
      toggleAux: () => set((s) => ({ auxVisible: !s.auxVisible })),
      setAuxWidth: (width) => set({ auxWidth: clamp(width, AUX_MIN, AUX_MAX) }),
    }),
    { name: "sageport.workbench" },
  ),
);
