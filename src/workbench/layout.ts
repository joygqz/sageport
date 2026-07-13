import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useZoomStore, zoomFactor } from "./zoom";
import {
  AUX_DEFAULT,
  AUX_MIN,
  PANEL_DEFAULT,
  PANEL_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  bottomPanelLimits,
  horizontalPanelLimits,
  type SashLimits,
} from "./layout-sizing";

export {
  AUX_DEFAULT,
  AUX_MIN,
  PANEL_DEFAULT,
  PANEL_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
} from "./layout-sizing";

export type Activity =
  "hosts" | "credentials" | "snippets" | "forwards" | "monitor";

const uiScale = () => zoomFactor(useZoomStore.getState().level);

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

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

function clampSidebar(
  width: number,
  s: { auxVisible: boolean; auxWidth: number },
) {
  const { min, max } = sidebarLimits(s);
  return clamp(width, min, max);
}

function clampAux(
  width: number,
  s: { sidebarVisible: boolean; sidebarWidth: number },
) {
  const { min, max } = auxLimits(s);
  return clamp(width, min, max);
}

function clampPanel(height: number) {
  const { min, max } = panelLimits();
  return clamp(height, min, max);
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      activity: "hosts",
      sidebarVisible: true,
      sidebarWidth: SIDEBAR_DEFAULT,
      panelVisible: false,
      panelHeight: PANEL_DEFAULT,
      auxVisible: false,
      auxWidth: AUX_DEFAULT,

      selectActivity: (activity) =>
        set((s) =>
          s.activity === activity
            ? { sidebarVisible: !s.sidebarVisible }
            : { activity, sidebarVisible: true },
        ),
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarWidth: (width) =>
        set((s) => ({
          sidebarWidth: clampSidebar(width, s),
          sidebarVisible: width >= (SIDEBAR_MIN * uiScale()) / 2,
        })),
      togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),
      setPanelVisible: (visible) => set({ panelVisible: visible }),
      setPanelHeight: (height) =>
        set({
          panelHeight: clampPanel(height),
          panelVisible: height >= (PANEL_MIN * uiScale()) / 2,
        }),
      toggleAux: () => set((s) => ({ auxVisible: !s.auxVisible })),
      setAuxWidth: (width) =>
        set((s) => ({
          auxWidth: clampAux(width, s),
          auxVisible: width >= (AUX_MIN * uiScale()) / 2,
        })),

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
