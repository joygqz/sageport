import { create } from "zustand";

import type { TerminalPane } from "@/workbench/tabs";

export function broadcastTargets(
  panes: readonly TerminalPane[],
  sourceId: string,
): TerminalPane[] {
  if (
    !panes.some((pane) => pane.id === sourceId && pane.status === "connected")
  ) {
    return [];
  }
  return panes.filter(
    (pane) => pane.id !== sourceId && pane.status === "connected",
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
