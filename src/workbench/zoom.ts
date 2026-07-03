import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFontSize } from "@/features/terminal/registry";
import { ipc } from "@/lib/ipc";
import { IS_MACOS } from "@/lib/platform";

/**
 * Whole-UI zoom, VSCode-style (mod+= / mod+- / mod+0). Every Tailwind size
 * in the app is rem-based, so scaling the root font-size scales the entire
 * workbench in lockstep. The terminal is the one px-based surface (xterm
 * renders to canvas), so its font size is derived from the same zoom level —
 * this keeps glyphs pixel-crisp at every zoom, unlike a webview-level zoom
 * which would just stretch the canvas.
 */

/** Root font-size at zoom level 0 (see globals.css for the rationale). */
const BASE_ROOT_FONT_PERCENT = 93.75;
/** Terminal canvas font at zoom level 0. */
const TERMINAL_FONT_BASE = 13;
/** Each level is ±10%, VSCode's step. */
const STEP = 0.1;
export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 5;

export function zoomFactor(level: number): number {
  return 1 + level * STEP;
}

/** Effective terminal font px for the current zoom level. */
export function terminalFontSize(): number {
  return Math.round(TERMINAL_FONT_BASE * zoomFactor(useZoomStore.getState().level));
}

/** Title bar height in rem — must match TitleBar's `h-9`. */
const TITLE_BAR_REM = 2.25;
/** Left inset of the macOS traffic lights at 100% zoom (system default). */
const TRAFFIC_LIGHT_X = 13;
/** Root font-size at 100% zoom: 16px × 93.75%. */
const BASE_ROOT_FONT_PX = 15;

/**
 * Keep the macOS traffic lights vertically centered in the title bar, which
 * grows and shrinks with the UI zoom. Both the height and the left inset
 * follow the live root font-size, so the lights track the zoom level like
 * every other title-bar element (their padding reservation in TitleBar is
 * rem-based too). Also re-invoked from the workbench on window resize /
 * theme change, since AppKit resets the buttons to their default spot on
 * those.
 */
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
  /** Re-apply the persisted level to the document, on workbench mount. */
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
        init: () => applyZoom(get().level),
      };
    },
    { name: "sageport.zoom" },
  ),
);
