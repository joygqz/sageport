import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { HostStats } from "@/types/models";

interface MonitorEntry {
  attempt: number;
  stats?: HostStats;
  unsupported: boolean;
}

export interface StatsPercents {
  cpu: number;
  mem: number;
  disk: number;
}

export function statsPercents(stats: HostStats): StatsPercents {
  const percent = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  return {
    cpu: percent((stats.cpuLoad / Math.max(stats.cpuCount, 1)) * 100),
    mem:
      stats.memTotal > 0 ? percent((stats.memUsed / stats.memTotal) * 100) : 0,
    disk:
      stats.diskTotal > 0
        ? percent((stats.diskUsed / stats.diskTotal) * 100)
        : 0,
  };
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

let bridgePromise: Promise<void> | undefined;
let monitorUnlisten: (() => void) | undefined;

export function bridgeMonitorEvents(): Promise<void> {
  if (monitorUnlisten) return Promise.resolve();
  if (bridgePromise) return bridgePromise;

  bridgePromise = ipc.monitor
    .onStats((event) => {
      if (started.get(event.sessionId) !== event.attempt) return;
      useMonitorStore.getState().set(event.sessionId, {
        attempt: event.attempt,
        stats: event.stats,
        unsupported: event.unsupported,
      });
    })
    .then((unlisten) => {
      monitorUnlisten = unlisten;
    })
    .finally(() => {
      bridgePromise = undefined;
    });
  return bridgePromise;
}

const started = new Map<string, number>();

export async function startMonitor(sessionId: string, attempt: number) {
  if (started.get(sessionId) === attempt) return;
  started.set(sessionId, attempt);
  const current = useMonitorStore.getState().bySession[sessionId];
  if (current && current.attempt !== attempt) {
    useMonitorStore.getState().clear(sessionId);
  }
  void bridgeMonitorEvents()
    .catch(() => bridgeMonitorEvents())
    .catch(() => {});
  try {
    await ipc.monitor.start(sessionId, attempt);
  } catch (error) {
    if (started.get(sessionId) === attempt) started.delete(sessionId);
    throw error;
  }
}

export function stopMonitor(sessionId: string, attempt: number) {
  if (started.get(sessionId) !== attempt) return;
  started.delete(sessionId);
  void ipc.monitor.stop(sessionId, attempt).catch(() => {});
  const entry = useMonitorStore.getState().bySession[sessionId];
  if (!entry || entry.attempt === attempt) {
    useMonitorStore.getState().clear(sessionId);
  }
}
