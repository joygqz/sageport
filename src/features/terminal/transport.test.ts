import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PtyDataEvent, PtyExitEvent } from "@/types/models";

const mocks = vi.hoisted(() => ({
  open: vi.fn(() => Promise.resolve()),
  write: vi.fn(() => Promise.resolve()),
  resize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  dataHandlers: [] as Array<(event: PtyDataEvent) => void>,
  exitHandlers: [] as Array<(event: PtyExitEvent) => void>,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    pty: {
      open: mocks.open,
      write: mocks.write,
      resize: mocks.resize,
      close: mocks.close,
      onData: vi.fn((handler: (event: PtyDataEvent) => void) => {
        mocks.dataHandlers.push(handler);
        return Promise.resolve(() => {});
      }),
      onExit: vi.fn((handler: (event: PtyExitEvent) => void) => {
        mocks.exitHandlers.push(handler);
        return Promise.resolve(() => {});
      }),
    },
  },
}));

import { localTransport } from "./transport";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataHandlers.length = 0;
  mocks.exitHandlers.length = 0;
});

describe("localTransport", () => {
  it("routes every operation through the current attempt", async () => {
    const transport = localTransport("local-1", 3);
    const statuses: string[] = [];
    await transport.onStatus((event) => statuses.push(event.status));

    await transport.connect({ cols: 90, rows: 30 });
    await transport.send("echo ok\r");
    await transport.resize(100, 40);
    await transport.disconnect();

    expect(mocks.open).toHaveBeenCalledWith({
      sessionId: "local-1",
      attempt: 3,
      cols: 90,
      rows: 30,
    });
    expect(mocks.write).toHaveBeenCalledWith("local-1", 3, "echo ok\r");
    expect(mocks.resize).toHaveBeenCalledWith("local-1", 3, 100, 40);
    expect(mocks.close).toHaveBeenCalledWith("local-1", 3);
    expect(statuses).toEqual(["connected"]);
  });

  it("ignores output and exit events from stale attempts", async () => {
    const transport = localTransport("local-1", 4);
    const data: number[][] = [];
    const statuses: string[] = [];
    await transport.onData((bytes) => data.push([...bytes]));
    await transport.onStatus((event) => statuses.push(event.status));

    mocks.dataHandlers[0]!({
      id: "local-1",
      attempt: 3,
      data: "b2xk",
    });
    mocks.exitHandlers[0]!({ id: "local-1", attempt: 3, code: 0 });
    mocks.dataHandlers[0]!({
      id: "local-1",
      attempt: 4,
      data: "bmV3",
    });
    mocks.exitHandlers[0]!({ id: "local-1", attempt: 4, code: 0 });

    expect(data).toEqual([[110, 101, 119]]);
    expect(statuses).toEqual(["closed"]);
  });
});
