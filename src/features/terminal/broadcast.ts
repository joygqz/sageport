import { create } from "zustand";

interface BroadcastState {
  enabled: boolean;
  toggle: () => void;
  disable: () => void;
}

export const useBroadcastStore = create<BroadcastState>((set) => ({
  enabled: false,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  disable: () => set({ enabled: false }),
}));
