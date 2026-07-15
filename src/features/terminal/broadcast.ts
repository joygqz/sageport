import { create } from "zustand";

import type { TerminalTab } from "@/workbench/tabs";

export function broadcastTargets(
  tabs: readonly TerminalTab[],
  sourceId: string,
): TerminalTab[] {
  if (!tabs.some((tab) => tab.id === sourceId && tab.status === "connected")) {
    return [];
  }
  return tabs.filter(
    (tab) => tab.id !== sourceId && tab.status === "connected",
  );
}

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
