import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useZoomStore, zoomFactor } from "./zoom";
import {
  AUX_MIN,
  PANEL_MIN,
  SIDEBAR_MIN,
  bottomPanelLimits,
  horizontalPanelLimits,
  type SashLimits,
} from "./layout-sizing";
import {
  DEFAULT_LAYOUT,
  normalizeLayoutSnapshot,
  type Activity,
  type LayoutSnapshot,
} from "./layout-state";

export {
  AUX_DEFAULT,
  AUX_MIN,
  PANEL_DEFAULT,
  PANEL_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
} from "./layout-sizing";

export type { Activity } from "./layout-state";

const uiScale = () => zoomFactor(useZoomStore.getState().level);

interface LayoutState {
  activity: Activity;
  sidebarVisible: boolean;
  sidebarWidth: number;

  panelVisible: boolean;
  panelHeight: number;

  auxVisible: boolean;
  auxWidth: number;

  selectActivity: (activity: Activity) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  togglePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  setPanelHeight: (height: number) => void;
  toggleAux: () => void;
  setAuxWidth: (width: number) => void;

  clampToViewport: () => void;
}

export function sidebarLimits(
  s: Pick<LayoutState, "auxVisible" | "auxWidth"> = useLayoutStore.getState(),
  viewportWidth = window.innerWidth,
  scale = uiScale(),
): SashLimits {
  return horizontalPanelLimits(
    SIDEBAR_MIN,
    s.auxVisible ? s.auxWidth : 0,
    viewportWidth,
    scale,
  );
}

export function auxLimits(
  s: Pick<
    LayoutState,
    "sidebarVisible" | "sidebarWidth"
  > = useLayoutStore.getState(),
  viewportWidth = window.innerWidth,
  scale = uiScale(),
): SashLimits {
  return horizontalPanelLimits(
    AUX_MIN,
    s.sidebarVisible ? s.sidebarWidth : 0,
    viewportWidth,
    scale,
  );
}

export function panelLimits(
  viewportHeight = window.innerHeight,
  scale = uiScale(),
): SashLimits {
  return bottomPanelLimits(viewportHeight, scale);
}

function snapshot(state: LayoutSnapshot): LayoutSnapshot {
  return {
    activity: state.activity,
    sidebarVisible: state.sidebarVisible,
    sidebarWidth: state.sidebarWidth,
    panelVisible: state.panelVisible,
    panelHeight: state.panelHeight,
    auxVisible: state.auxVisible,
    auxWidth: state.auxWidth,
  };
}

function environment() {
  return {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scale: uiScale(),
  };
}

function normalize(
  value: unknown,
  fallback: LayoutSnapshot = DEFAULT_LAYOUT,
): LayoutSnapshot {
  return normalizeLayoutSnapshot(value, environment(), fallback);
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clampToLimits(value: number, limits: SashLimits): number {
  return Math.max(limits.min, Math.min(value, limits.max));
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_LAYOUT,

      selectActivity: (activity) =>
        set((s) =>
          normalize(
            {
              ...snapshot(s),
              activity,
              sidebarVisible:
                s.activity === activity ? !s.sidebarVisible : true,
            },
            s,
          ),
        ),
      toggleSidebar: () =>
        set((s) =>
          normalize({ ...snapshot(s), sidebarVisible: !s.sidebarVisible }, s),
        ),
      setSidebarWidth: (width) =>
        set((s) =>
          normalize(
            {
              ...snapshot(s),
              sidebarWidth: finite(width)
                ? clampToLimits(width, sidebarLimits(s))
                : s.sidebarWidth,
              sidebarVisible: finite(width)
                ? width >= (SIDEBAR_MIN * uiScale()) / 2
                : s.sidebarVisible,
            },
            s,
          ),
        ),
      togglePanel: () =>
        set((s) =>
          normalize({ ...snapshot(s), panelVisible: !s.panelVisible }, s),
        ),
      setPanelVisible: (visible) =>
        set((s) => normalize({ ...snapshot(s), panelVisible: visible }, s)),
      setPanelHeight: (height) =>
        set((s) =>
          normalize(
            {
              ...snapshot(s),
              panelHeight: finite(height)
                ? clampToLimits(height, panelLimits())
                : s.panelHeight,
              panelVisible: finite(height)
                ? height >= (PANEL_MIN * uiScale()) / 2
                : s.panelVisible,
            },
            s,
          ),
        ),
      toggleAux: () =>
        set((s) => normalize({ ...snapshot(s), auxVisible: !s.auxVisible }, s)),
      setAuxWidth: (width) =>
        set((s) =>
          normalize(
            {
              ...snapshot(s),
              auxWidth: finite(width)
                ? clampToLimits(width, auxLimits(s))
                : s.auxWidth,
              auxVisible: finite(width)
                ? width >= (AUX_MIN * uiScale()) / 2
                : s.auxVisible,
            },
            s,
          ),
        ),

      clampToViewport: () => {
        const s = get();
        set(normalize(snapshot(s), s));
      },
    }),
    {
      name: "sageport.workbench",
      partialize: (state) => snapshot(state),
      merge: (persisted, current) => ({
        ...current,
        ...normalize(persisted, current),
      }),
    },
  ),
);
