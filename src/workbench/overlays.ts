import { create } from "zustand";

export type Overlay =
  | { type: "host-form"; hostId: string | null }
  | { type: "group-form"; groupId: string | null }
  | { type: "palette"; mode: "quick" | "commands" };

interface OverlayState {
  overlay: Overlay | null;
  openHostForm: (hostId?: string) => void;
  openGroupForm: (groupId?: string) => void;
  openPalette: (mode: "quick" | "commands") => void;
  close: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  overlay: null,
  openHostForm: (hostId) =>
    set({ overlay: { type: "host-form", hostId: hostId ?? null } }),
  openGroupForm: (groupId) =>
    set({ overlay: { type: "group-form", groupId: groupId ?? null } }),
  openPalette: (mode) => set({ overlay: { type: "palette", mode } }),
  close: () => set({ overlay: null }),
}));
