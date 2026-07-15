import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HostKeyEvent } from "@/types/models";

const mocks = vi.hoisted(() => ({
  pendingHostKeys: vi.fn(),
  respondHostKey: vi.fn(() => Promise.resolve()),
  promptListener: undefined as ((event: HostKeyEvent) => void) | undefined,
  closedListener: undefined as
    ((event: { promptId: string }) => void) | undefined,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ssh: {
      onHostKey: vi.fn((listener: (event: HostKeyEvent) => void) => {
        mocks.promptListener = listener;
        return Promise.resolve(vi.fn());
      }),
      onHostKeyClosed: vi.fn(
        (listener: (event: { promptId: string }) => void) => {
          mocks.closedListener = listener;
          return Promise.resolve(vi.fn());
        },
      ),
      pendingHostKeys: mocks.pendingHostKeys,
      respondHostKey: mocks.respondHostKey,
    },
  },
}));

import {
  hasHostKeyPrompt,
  listenHostKeyEvents,
  useHostKeyStore,
} from "./host-key";

function prompt(promptId: string, sessionId = "session-1"): HostKeyEvent {
  return {
    promptId,
    sessionId,
    host: "example.com",
    port: 22,
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:test",
    status: "unknown",
  };
}

describe("host key prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promptListener = undefined;
    mocks.closedListener = undefined;
    mocks.pendingHostKeys.mockResolvedValue([]);
    useHostKeyStore.setState({ queue: [] });
  });

  it("recovers and deduplicates a prompt emitted before listening", async () => {
    mocks.pendingHostKeys.mockImplementation(async () => {
      mocks.promptListener?.(prompt("pending"));
      return [prompt("pending")];
    });

    await listenHostKeyEvents();

    expect(useHostKeyStore.getState().queue).toEqual([prompt("pending")]);
    expect(hasHostKeyPrompt("session-1")).toBe(true);
  });

  it("does not restore a prompt that closed during recovery", async () => {
    let finish: ((events: HostKeyEvent[]) => void) | undefined;
    mocks.pendingHostKeys.mockImplementation(
      () =>
        new Promise<HostKeyEvent[]>((resolve) => {
          finish = resolve;
        }),
    );
    const listening = listenHostKeyEvents();
    await vi.waitFor(() => {
      expect(mocks.closedListener).toBeTypeOf("function");
      expect(mocks.pendingHostKeys).toHaveBeenCalledOnce();
    });

    mocks.closedListener?.({ promptId: "closed" });
    finish?.([prompt("closed")]);
    await listening;

    expect(useHostKeyStore.getState().queue).toEqual([]);
  });

  it("restores a prompt when sending the decision fails", async () => {
    mocks.respondHostKey.mockRejectedValueOnce(new Error("invoke failed"));
    useHostKeyStore.setState({ queue: [prompt("retry")] });

    useHostKeyStore.getState().respond("retry", "remember");
    expect(useHostKeyStore.getState().queue).toEqual([]);
    await vi.waitFor(() => {
      expect(useHostKeyStore.getState().queue).toEqual([prompt("retry")]);
    });
  });

  it("rejects only prompts belonging to the closing session", () => {
    useHostKeyStore.setState({
      queue: [prompt("first"), prompt("other", "session-2")],
    });

    useHostKeyStore.getState().rejectSession("session-1");

    expect(mocks.respondHostKey).toHaveBeenCalledWith("first", "reject");
    expect(useHostKeyStore.getState().queue).toEqual([
      prompt("other", "session-2"),
    ]);
  });
});
