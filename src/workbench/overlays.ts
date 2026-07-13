import { create } from "zustand";

export type SettingsSection = "appearance" | "ai" | "sync" | "about";

export type Overlay =
  | { type: "host-form"; hostId: string | null }
  | { type: "group-form"; groupId: string | null }
  | { type: "palette"; mode: "quick" | "commands" }
  | { type: "settings"; section: SettingsSection };

interface OverlayState {
  overlay: Overlay | null;
  openHostForm: (hostId?: string) => void;
  openGroupForm: (groupId?: string) => void;
  openPalette: (mode: "quick" | "commands") => void;
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  close: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  overlay: null,
  openHostForm: (hostId) =>
    set({ overlay: { type: "host-form", hostId: hostId ?? null } }),
  openGroupForm: (groupId) =>
    set({ overlay: { type: "group-form", groupId: groupId ?? null } }),
  openPalette: (mode) => set({ overlay: { type: "palette", mode } }),
  openSettings: (section) =>
    set((state) => ({
      overlay: {
        type: "settings",
        section:
          section ??
          (state.overlay?.type === "settings"
            ? state.overlay.section
            : "appearance"),
      },
    })),
  setSettingsSection: (section) =>
    set((state) =>
      state.overlay?.type === "settings"
        ? { overlay: { ...state.overlay, section } }
        : state,
    ),
  close: () => set({ overlay: null }),
}));
