import { create } from "zustand";

export type SettingsSection =
  "general" | "appearance" | "ai" | "sync" | "about";

export type Overlay =
  | { type: "host-form"; hostId: string | null; groupId: string | null }
  | { type: "group-form"; groupId: string | null; parentId: string | null }
  | { type: "palette"; mode: "quick" | "commands" }
  | { type: "settings"; section: SettingsSection };

interface OverlayState {
  overlay: Overlay | null;
  openHostForm: (hostId?: string, groupId?: string) => void;
  openGroupForm: (groupId?: string, parentId?: string) => void;
  openPalette: (mode: "quick" | "commands") => void;
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  close: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  overlay: null,
  openHostForm: (hostId, groupId) =>
    set({
      overlay: {
        type: "host-form",
        hostId: hostId ?? null,
        groupId: groupId ?? null,
      },
    }),
  openGroupForm: (groupId, parentId) =>
    set({
      overlay: {
        type: "group-form",
        groupId: groupId ?? null,
        parentId: parentId ?? null,
      },
    }),
  openPalette: (mode) => set({ overlay: { type: "palette", mode } }),
  openSettings: (section) =>
    set((state) => ({
      overlay: {
        type: "settings",
        section:
          section ??
          (state.overlay?.type === "settings"
            ? state.overlay.section
            : "general"),
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
