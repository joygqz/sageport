import { create } from "zustand";

export type SettingsSection =
  | "appearance"
  | "ai"
  | "keys"
  | "identities"
  | "snippets"
  | "sync"
  | "about";

/**
 * Which in-app dialog (if any) is currently shown over the main window.
 * Settings/host-form/group-form used to be separate OS windows; now they're
 * overlays within the single window, so "open" just means "set this value".
 */
export type Overlay =
  | { type: "settings"; section: SettingsSection }
  | { type: "host-form"; hostId: string | null }
  | { type: "group-form"; groupId: string | null };

interface OverlayState {
  overlay: Overlay | null;
  openSettings: (section?: SettingsSection) => void;
  openHostForm: (hostId?: string) => void;
  openGroupForm: (groupId?: string) => void;
  close: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  overlay: null,
  openSettings: (section = "appearance") =>
    set({ overlay: { type: "settings", section } }),
  openHostForm: (hostId) =>
    set({ overlay: { type: "host-form", hostId: hostId ?? null } }),
  openGroupForm: (groupId) =>
    set({ overlay: { type: "group-form", groupId: groupId ?? null } }),
  close: () => set({ overlay: null }),
}));
