import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFontFamily } from "@/features/terminal/sessions";

export const FONT_SYNC_KEY = "appearance.fontFamily";

function defaultMonoStack(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
}

export function monoFontFamily(
  family = useFontStore.getState().family,
): string {
  const custom = family.trim().replace(/,+\s*$/, "");
  return custom ? `${custom}, ${defaultMonoStack()}` : defaultMonoStack();
}

interface FontState {
  family: string;
  setFamily: (family: string) => void;
}

export const useFontStore = create<FontState>()(
  persist(
    (set) => ({
      family: "",
      setFamily: (family: string) => {
        set({ family });
        applyTerminalFontFamily(monoFontFamily(family));
      },
    }),
    { name: "sageport.font" },
  ),
);
