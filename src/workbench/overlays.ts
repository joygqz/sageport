import { create } from "zustand";

/**
 * Modal surfaces that float over the workbench: entity forms and the
 * command palette. Exactly one can be open at a time.
 */

export type Overlay =
  | { type: "host-form"; hostId: string | null }
  | { type: "group-form"; groupId: string | null }
  /** `mode` mirrors VSCode quick open: plain text finds hosts, ">" runs commands. */
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
