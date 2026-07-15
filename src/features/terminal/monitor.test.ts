import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostStats, MonitorStatsEvent } from "@/types/models";

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  onStats: vi.fn(),
  statsHandler: undefined as ((event: MonitorStatsEvent) => void) | undefined,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    monitor: {
      start: mocks.start,
      stop: mocks.stop,
      onStats: mocks.onStats,
    },
  },
}));

import {
  bridgeMonitorEvents,
  startMonitor,
  statsPercents,
  stopMonitor,
  useMonitorStore,
} from "./monitor";

const stats: HostStats = {
  cpuLoad: 2,
  cpuCount: 4,
  memUsed: 50,
  memTotal: 100,
  diskUsed: 25,
  diskTotal: 100,
};

function emit(sessionId: string, attempt: number, nextStats = stats) {
  mocks.statsHandler?.({
    sessionId,
    attempt,
    stats: nextStats,
    unsupported: false,
  });
}

describe("monitor lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onStats.mockImplementation(
      async (handler: (event: MonitorStatsEvent) => void) => {
        mocks.statsHandler = handler;
        return () => {};
      },
    );
    useMonitorStore.setState({ bySession: {} });
  });

  it("retries event registration after an initialization failure", async () => {
    mocks.onStats.mockRejectedValueOnce(new Error("listen failed"));

    await expect(bridgeMonitorEvents()).rejects.toThrow("listen failed");
    await expect(bridgeMonitorEvents()).resolves.toBeUndefined();

    expect(mocks.onStats).toHaveBeenCalledTimes(2);
  });

  it("isolates reconnect attempts and ignores events after stopping", async () => {
    await bridgeMonitorEvents();
    await startMonitor("session", 1);
    emit("session", 1);
    expect(useMonitorStore.getState().bySession.session?.stats).toEqual(stats);

    await startMonitor("session", 2);
    expect(useMonitorStore.getState().bySession.session).toBeUndefined();
    emit("session", 1);
    expect(useMonitorStore.getState().bySession.session).toBeUndefined();
    emit("session", 2);
    expect(useMonitorStore.getState().bySession.session?.attempt).toBe(2);

    stopMonitor("session", 1);
    expect(useMonitorStore.getState().bySession.session?.attempt).toBe(2);
    expect(mocks.stop).not.toHaveBeenCalled();

    stopMonitor("session", 2);
    expect(mocks.stop).toHaveBeenCalledWith("session", 2);
    expect(useMonitorStore.getState().bySession.session).toBeUndefined();
    emit("session", 2);
    expect(useMonitorStore.getState().bySession.session).toBeUndefined();
  });

  it("allows a failed start to be retried", async () => {
    mocks.start.mockRejectedValueOnce(new Error("start failed"));

    await expect(startMonitor("retry", 3)).rejects.toThrow("start failed");
    await expect(startMonitor("retry", 3)).resolves.toBeUndefined();

    expect(mocks.start).toHaveBeenCalledTimes(2);
    stopMonitor("retry", 3);
  });
});

describe("statsPercents", () => {
  it("clamps invalid and out-of-range metrics", () => {
    expect(
      statsPercents({
        ...stats,
        cpuLoad: Number.NaN,
        memUsed: 200,
        diskUsed: -10,
      }),
    ).toEqual({ cpu: 0, mem: 100, disk: 0 });
  });
});
