import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFontSize } from "./registry";

/**
 * User-adjustable terminal preferences, persisted across launches.
 * Font size is changed with the editor-style zoom shortcuts
 * (mod+= / mod+- / mod+0) and applies to every open session at once.
 */

export const TERMINAL_FONT_DEFAULT = 13;
export const TERMINAL_FONT_MIN = 8;
export const TERMINAL_FONT_MAX = 32;

interface TerminalSettingsState {
  fontSize: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

const clamp = (v: number) =>
  Math.max(TERMINAL_FONT_MIN, Math.min(v, TERMINAL_FONT_MAX));

export const useTerminalSettings = create<TerminalSettingsState>()(
  persist(
    (set, get) => {
      const apply = (fontSize: number) => {
        set({ fontSize });
        applyTerminalFontSize(fontSize);
      };
      return {
        fontSize: TERMINAL_FONT_DEFAULT,
        zoomIn: () => apply(clamp(get().fontSize + 1)),
        zoomOut: () => apply(clamp(get().fontSize - 1)),
        resetZoom: () => apply(TERMINAL_FONT_DEFAULT),
      };
    },
    { name: "sageport.terminal" },
  ),
);
