import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFontFamily } from "@/features/terminal/registry";

export const FONT_FAMILY_DEFAULT =
  '"JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace';

export const FONT_FAMILY_SYNC_KEY = "appearance.fontFamily";

function applyFontFamily(family: string) {
  document.documentElement.style.setProperty("--font-mono", family);
  applyTerminalFontFamily(family);
}

interface FontState {
  fontFamily: string;
  setFontFamily: (family: string) => void;
  resetFontFamily: () => void;
  init: () => void;
}

export const useFontStore = create<FontState>()(
  persist(
    (set, get) => ({
      fontFamily: FONT_FAMILY_DEFAULT,
      setFontFamily: (family) => {
        const next = family.trim() || FONT_FAMILY_DEFAULT;
        set({ fontFamily: next });
        applyFontFamily(next);
      },
      resetFontFamily: () => {
        set({ fontFamily: FONT_FAMILY_DEFAULT });
        applyFontFamily(FONT_FAMILY_DEFAULT);
      },
      init: () => applyFontFamily(get().fontFamily),
    }),
    { name: "sageport.fonts" },
  ),
);
