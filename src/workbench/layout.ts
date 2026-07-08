import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useZoomStore, zoomFactor } from "./zoom";

export type Activity =
  | "hosts"
  | "credentials"
  | "snippets"
  | "forwards"
  | "monitor";

export const SIDEBAR_MIN = 150;
export const PANEL_MIN = 100;
export const AUX_MIN = 150;

const ACTIVITY_BAR_W = 45;
const TITLE_BAR_H = 33.75;
const STATUS_BAR_H = 22.5;

const EDITOR_MIN_W = 70;
const EDITOR_MIN_H = 70;

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

function maxWidthFor(other: number): number {
  return Math.max(
    0,
    window.innerWidth - (ACTIVITY_BAR_W + EDITOR_MIN_W) * uiScale() - other,
  );
}

export interface SashLimits {
  min: number;
  max: number;
}

export function sidebarLimits(
  s: Pick<LayoutState, "auxVisible" | "auxWidth"> = useLayoutStore.getState(),
): SashLimits {
  const min = SIDEBAR_MIN * uiScale();
  return {
    min,
    max: Math.max(min, maxWidthFor(s.auxVisible ? s.auxWidth : 0)),
  };
}

export function auxLimits(
  s: Pick<
    LayoutState,
    "sidebarVisible" | "sidebarWidth"
  > = useLayoutStore.getState(),
): SashLimits {
  const min = AUX_MIN * uiScale();
  return {
    min,
    max: Math.max(min, maxWidthFor(s.sidebarVisible ? s.sidebarWidth : 0)),
  };
}

export function panelLimits(): SashLimits {
  const min = PANEL_MIN * uiScale();
  const roomMax =
    window.innerHeight -
    (TITLE_BAR_H + STATUS_BAR_H + EDITOR_MIN_H) * uiScale();
  return { min, max: Math.max(min, roomMax) };
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
      sidebarWidth: 250,
      panelVisible: false,
      panelHeight: 250,
      auxVisible: false,
      auxWidth: 250,

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
