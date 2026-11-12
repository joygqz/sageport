import { describe, expect, it, vi } from "vitest";

import type { ForwardStatusEvent } from "@/types/models";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  onStatus: vi.fn(),
  unlisten: vi.fn(),
  handler: undefined as ((event: ForwardStatusEvent) => void) | undefined,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    forwards: {
      runtime: mocks.runtime,
      onStatus: mocks.onStatus,
    },
  },
}));

import { bridgeForwardEvents, useForwardStore } from "./store";

function event(
  status: ForwardStatusEvent["status"],
  sequence: number,
): ForwardStatusEvent {
  return {
    forwardId: "forward",
    status,
    generation: 1,
    sequence,
  };
}

describe("forward runtime state", () => {
  it("retries listener setup and applies events received during hydration", async () => {
    useForwardStore.setState({ runtime: {} });
    mocks.onStatus.mockRejectedValueOnce(new Error("listen failed"));
    await expect(bridgeForwardEvents()).rejects.toThrow("listen failed");

    mocks.onStatus.mockImplementationOnce(
      async (handler: (next: ForwardStatusEvent) => void) => {
        mocks.handler = handler;
        return mocks.unlisten;
      },
    );
    mocks.runtime.mockRejectedValueOnce(new Error("snapshot failed"));
    mocks.unlisten.mockImplementationOnce(() => {
      throw new Error("cleanup failed");
    });
    await expect(bridgeForwardEvents()).rejects.toThrow("snapshot failed");
    expect(mocks.unlisten).toHaveBeenCalledOnce();

    let resolveSnapshot: ((events: ForwardStatusEvent[]) => void) | undefined;
    mocks.onStatus.mockImplementation(
      async (handler: (next: ForwardStatusEvent) => void) => {
        mocks.handler = handler;
        return () => {};
      },
    );
    mocks.runtime.mockImplementation(
      () =>
        new Promise<ForwardStatusEvent[]>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const bridge = bridgeForwardEvents();
    await vi.waitFor(() => expect(mocks.handler).toBeTypeOf("function"));
    mocks.handler?.(event("active", 2));
    resolveSnapshot?.([event("starting", 1)]);
    await bridge;

    expect(useForwardStore.getState().runtime.forward?.status).toBe("active");
    useForwardStore.getState().apply(event("reconnecting", 3));
    expect(useForwardStore.getState().runtime.forward?.status).toBe(
      "reconnecting",
    );
    expect(mocks.onStatus).toHaveBeenCalledTimes(3);

    useForwardStore.getState().apply(event("stopped", 1));
    expect(useForwardStore.getState().runtime.forward?.status).toBe(
      "reconnecting",
    );
    useForwardStore.getState().remove("forward");
    expect(useForwardStore.getState().runtime.forward).toBeUndefined();
  });
  it("rejects late events from older generations and preserves connection diagnostics", () => {
    useForwardStore.setState({ runtime: {} });
    useForwardStore.getState().apply({
      ...event("active", 10),
      generation: 2,
      connectionFailures: 3,
      lastConnectionError: "connection refused",
    });
    useForwardStore.getState().apply({ ...event("error", 11), generation: 1 });
    expect(useForwardStore.getState().runtime.forward).toMatchObject({
      status: "active",
      generation: 2,
      connectionFailures: 3,
      lastConnectionError: "connection refused",
    });
    useForwardStore
      .getState()
      .apply({ ...event("starting", 12), generation: 3 });
    expect(
      useForwardStore.getState().runtime.forward?.connectionFailures,
    ).toBeUndefined();
    expect(
      useForwardStore.getState().runtime.forward?.lastConnectionError,
    ).toBeUndefined();
  });
});
