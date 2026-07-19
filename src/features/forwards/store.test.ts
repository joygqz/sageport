import { describe, expect, it, vi } from "vitest";

import type { ForwardStatusEvent } from "@/types/models";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  onStatus: vi.fn(),
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
  publicBindRestricted = false,
): ForwardStatusEvent {
  return {
    forwardId: "forward",
    status,
    generation: 1,
    sequence,
    publicBindRestricted,
  };
}

describe("forward runtime state", () => {
  it("retries listener setup and applies events received during hydration", async () => {
    useForwardStore.setState({ runtime: {} });
    mocks.onStatus.mockRejectedValueOnce(new Error("listen failed"));
    await expect(bridgeForwardEvents()).rejects.toThrow("listen failed");

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
    useForwardStore.getState().apply(event("active", 3, true));
    expect(
      useForwardStore.getState().runtime.forward?.publicBindRestricted,
    ).toBe(true);
    expect(mocks.onStatus).toHaveBeenCalledTimes(2);

    useForwardStore.getState().apply(event("stopped", 1));
    expect(useForwardStore.getState().runtime.forward?.status).toBe("active");
    useForwardStore.getState().remove("forward");
    expect(useForwardStore.getState().runtime.forward).toBeUndefined();
  });
});
