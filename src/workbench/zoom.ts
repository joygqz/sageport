import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFontSize } from "@/features/terminal/sessions";
import { ipc } from "@/lib/ipc";
import { IS_MACOS } from "@/lib/platform";

const BASE_ROOT_FONT_PERCENT = 93.75;

const TERMINAL_FONT_BASE = 13;

const STEP = 0.1;
export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 5;

export const ZOOM_SYNC_KEY = "appearance.zoomLevel";

export function zoomFactor(level: number): number {
  return 1 + level * STEP;
}

export function terminalFontSize(): number {
  return Math.round(
    TERMINAL_FONT_BASE * zoomFactor(useZoomStore.getState().level),
  );
}

const TITLE_BAR_REM = 2.5;

const TRAFFIC_LIGHT_X = 13;

const BASE_ROOT_FONT_PX = 15;

export function syncTrafficLights() {
  if (!IS_MACOS) return;
  const rootFontPx = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const scale = rootFontPx / BASE_ROOT_FONT_PX;
  const height = TITLE_BAR_REM * rootFontPx;
  void ipc.window
    .setTrafficLightInset(TRAFFIC_LIGHT_X * scale, height)
    .catch(() => {});
}

function applyZoom(level: number) {
  document.documentElement.style.fontSize = `${
    BASE_ROOT_FONT_PERCENT * zoomFactor(level)
  }%`;
  applyTerminalFontSize(Math.round(TERMINAL_FONT_BASE * zoomFactor(level)));
  syncTrafficLights();
}

const clamp = (level: number) =>
  Math.max(ZOOM_LEVEL_MIN, Math.min(level, ZOOM_LEVEL_MAX));

interface ZoomState {
  level: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  setLevel: (level: number) => void;

  init: () => void;
}

export const useZoomStore = create<ZoomState>()(
  persist(
    (set, get) => {
      const setLevel = (level: number) => {
        set({ level });
        applyZoom(level);
      };
      return {
        level: 0,
        zoomIn: () => setLevel(clamp(get().level + 1)),
        zoomOut: () => setLevel(clamp(get().level - 1)),
        resetZoom: () => setLevel(0),
        setLevel: (level: number) => setLevel(clamp(level)),
        init: () => applyZoom(get().level),
      };
    },
    { name: "sageport.zoom" },
  ),
);
