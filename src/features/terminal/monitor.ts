import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { HostStats } from "@/types/models";

interface MonitorEntry {
  stats?: HostStats;
  unsupported: boolean;
}

interface MonitorState {
  bySession: Record<string, MonitorEntry>;
  set: (sessionId: string, entry: MonitorEntry) => void;
  clear: (sessionId: string) => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  bySession: {},
  set: (sessionId, entry) =>
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: entry } })),
  clear: (sessionId) =>
    set((s) => {
      const bySession = { ...s.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
}));

let bridged = false;

export function bridgeMonitorEvents() {
  if (bridged) return;
  bridged = true;
  void ipc.monitor.onStats((event) => {
    useMonitorStore.getState().set(event.sessionId, {
      stats: event.stats,
      unsupported: event.unsupported,
    });
  });
}

const started = new Set<string>();

export function startMonitor(sessionId: string) {
  if (started.has(sessionId)) return;
  started.add(sessionId);
  void ipc.monitor.start(sessionId).catch(() => started.delete(sessionId));
}

export function stopMonitor(sessionId: string) {
  if (!started.has(sessionId)) return;
  started.delete(sessionId);
  void ipc.monitor.stop(sessionId).catch(() => {});
  useMonitorStore.getState().clear(sessionId);
}
