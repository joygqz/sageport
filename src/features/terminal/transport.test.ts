import type { Channel } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalStreamEvent } from "@/types/models";
import { localTransport, sshAdhocTransport, sshTransport } from "./transport";

const requests: Array<{ command: string; args: Record<string, unknown> }> = [];

function stream(index = 0): Channel<TerminalStreamEvent> {
  return requests[index]!.args.onEvent as Channel<TerminalStreamEvent>;
}

function deliver(
  channel: Channel<TerminalStreamEvent>,
  index: number,
  message: TerminalStreamEvent,
) {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__: {
        runCallback(id: number, data: unknown): void;
      };
    }
  ).__TAURI_INTERNALS__;
  internals.runCallback(channel.id, { index, message });
}

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("window", { crypto: globalThis.crypto });
  mockIPC((command, args) => {
    requests.push({ command, args: args as Record<string, unknown> });
  });
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe("terminal streams", () => {
  it.each([
    ["local", () => localTransport("session", 3), "pty_open"],
    ["SSH", () => sshTransport("session", "host", 3), "ssh_connect"],
    [
      "ad hoc SSH",
      () =>
        sshAdhocTransport("session", 3, {
          host: "localhost",
          port: 22,
          username: "tester",
        }),
      "ssh_connect_adhoc",
    ],
  ] as const)(
    "opens an isolated channel for %s",
    async (_, create, command) => {
      const transport = create();
      await transport.onData(() => {});
      await transport.onStatus(() => {});
      expect(requests).toEqual([]);

      await transport.connect({ cols: 90, rows: 30 });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({
        command,
        args: expect.objectContaining({
          sessionId: "session",
          attempt: 3,
          cols: 90,
          rows: 30,
          onEvent: expect.objectContaining({ onmessage: expect.any(Function) }),
        }),
      });
    },
  );

  it("preserves binary bytes and delivers trailing output before closed", async () => {
    const transport = localTransport("local", 1);
    const received: Array<string | number[]> = [];
    await transport.onData((bytes) => received.push([...bytes]));
    await transport.onStatus((event) => received.push(event.status));
    await transport.connect({ cols: 80, rows: 24 });

    deliver(stream(), 2, { status: "closed" });
    deliver(stream(), 0, { status: "connected" });
    expect(received).toEqual(["connected"]);
    deliver(stream(), 1, new Uint8Array([0, 255, 0xe4, 0xb8, 0xad]).buffer);

    expect(received).toEqual([
      "connected",
      [0, 255, 0xe4, 0xb8, 0xad],
      "closed",
    ]);
  });

  it("isolates attempts and stops delivering after disconnect", async () => {
    const first = localTransport("local", 1);
    const second = localTransport("local", 2);
    const firstData = vi.fn();
    const secondData = vi.fn();
    const firstStatus = vi.fn();
    await first.onData(firstData);
    await first.onStatus(firstStatus);
    await second.onData(secondData);
    await first.connect({ cols: 80, rows: 24 });
    await second.connect({ cols: 80, rows: 24 });
    const previous = stream(0);
    const current = stream(1);

    await first.disconnect();
    deliver(previous, 0, new Uint8Array([1]).buffer);
    deliver(previous, 1, { status: "closed" });
    deliver(current, 0, new Uint8Array([2]).buffer);

    expect(firstData).not.toHaveBeenCalled();
    expect(firstStatus).not.toHaveBeenCalled();
    expect(secondData).toHaveBeenCalledExactlyOnceWith(new Uint8Array([2]));
    expect(requests.at(-1)).toEqual({
      command: "pty_close",
      args: { sessionId: "local", attempt: 1 },
    });
  });

  it("releases subscriptions without detaching a replacement handler", async () => {
    const transport = sshTransport("session", "host", 1);
    const previous = vi.fn();
    const current = vi.fn();
    const unlistenPrevious = await transport.onData(previous);
    const unlistenCurrent = await transport.onData(current);
    unlistenPrevious();
    await transport.connect({ cols: 80, rows: 24 });
    deliver(stream(), 0, new Uint8Array([1]).buffer);
    unlistenCurrent();
    deliver(stream(), 1, new Uint8Array([2]).buffer);

    expect(previous).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledExactlyOnceWith(new Uint8Array([1]));
  });

  it.each([
    [
      () => localTransport("session", 3),
      "pty_write",
      "pty_resize",
      "pty_close",
    ],
    [
      () => sshTransport("session", "host", 3),
      "ssh_send",
      "ssh_resize",
      "ssh_disconnect",
    ],
  ] as const)(
    "routes input, resize and close through the current attempt",
    async (create, send, resize, close) => {
      const transport = create();
      await transport.send("echo ok\r");
      await transport.resize(100, 40);
      await transport.disconnect();
      expect(requests).toEqual([
        {
          command: send,
          args: { sessionId: "session", attempt: 3, data: "echo ok\r" },
        },
        {
          command: resize,
          args: { sessionId: "session", attempt: 3, cols: 100, rows: 40 },
        },
        { command: close, args: { sessionId: "session", attempt: 3 } },
      ]);
    },
  );
});
