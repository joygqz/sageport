import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalFont } from "./registry";

/** Predefined terminal font options. */
export const PRESET_FONTS = [
  { id: "jetbrains-mono", name: "JetBrains Mono", family: '"JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "jetbrains-mono-nerd", name: "JetBrainsMono Nerd Font", family: '"JetBrainsMono Nerd Font", "JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "cascadia-code", name: "Cascadia Code", family: '"Cascadia Code", "JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "cascadia-code-nerd", name: "CascadiaCode Nerd Font", family: '"CascadiaCode Nerd Font", "Cascadia Code", "JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "fira-code", name: "Fira Code", family: '"Fira Code", "JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "fira-code-nerd", name: "FiraCode Nerd Font", family: '"FiraCode Nerd Font", "Fira Code", "JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace' },
  { id: "custom", name: "Custom…", family: "" },
] as const;

export type PresetFontId = (typeof PRESET_FONTS)[number]["id"];

export function resolveFontFamily(
  preset: PresetFontId,
  customFamily: string,
): string {
  if (preset === "custom") {
    return customFamily || '"JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace';
  }
  return PRESET_FONTS.find((f) => f.id === preset)?.family ?? PRESET_FONTS[0].family;
}

const SYNC_KEY = "terminal.font";

interface FontState {
  preset: PresetFontId;
  customFamily: string;
  setPreset: (preset: PresetFontId) => void;
  setCustomFamily: (family: string) => void;
}

function apply(preset: PresetFontId, customFamily: string) {
  const family = resolveFontFamily(preset, customFamily);
  applyTerminalFont(family);
}

export const useFontStore = create<FontState>()(
  persist(
    (set, get) => ({
      preset: "jetbrains-mono",
      customFamily: "",
      setPreset: (preset: PresetFontId) => {
        set({ preset });
        apply(preset, get().customFamily);
      },
      setCustomFamily: (customFamily: string) => {
        set({ customFamily });
        apply(get().preset, customFamily);
      },
    }),
    { name: SYNC_KEY },
  ),
);
