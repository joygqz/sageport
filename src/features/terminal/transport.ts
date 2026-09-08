import { Channel } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { ipc } from "@/lib/ipc";
import type { TerminalStreamEvent } from "@/types/models";
import type { TerminalStatus } from "@/workbench/tabs";

export interface TerminalStatusUpdate {
  status: TerminalStatus;
  message?: string;
  code?: string;
}

export interface TerminalTransport {
  connect(dims: { cols: number; rows: number }): Promise<void>;
  send(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (bytes: Uint8Array) => void): Promise<UnlistenFn>;
  onStatus(
    handler: (update: TerminalStatusUpdate) => void,
  ): Promise<UnlistenFn>;
}

function streamTransport(
  connect: (
    dims: { cols: number; rows: number },
    onEvent: Channel<TerminalStreamEvent>,
  ) => Promise<void>,
  operations: Pick<TerminalTransport, "send" | "resize" | "disconnect">,
): TerminalTransport {
  let onData: ((bytes: Uint8Array) => void) | undefined;
  let onStatus: ((update: TerminalStatusUpdate) => void) | undefined;

  return {
    ...operations,
    connect: (dims) =>
      connect(
        dims,
        new Channel<TerminalStreamEvent>((event) => {
          if (event instanceof ArrayBuffer) onData?.(new Uint8Array(event));
          else onStatus?.(event);
        }),
      ),
    disconnect: () => {
      onData = undefined;
      onStatus = undefined;
      return operations.disconnect();
    },
    onData: (handler) => {
      onData = handler;
      return Promise.resolve(() => {
        if (onData === handler) onData = undefined;
      });
    },
    onStatus: (handler) => {
      onStatus = handler;
      return Promise.resolve(() => {
        if (onStatus === handler) onStatus = undefined;
      });
    },
  };
}

function sshOperations(sessionId: string, attempt: number) {
  return {
    send: (data: string) => ipc.ssh.send(sessionId, attempt, data),
    resize: (cols: number, rows: number) =>
      ipc.ssh.resize(sessionId, attempt, cols, rows),
    disconnect: () => ipc.ssh.disconnect(sessionId, attempt),
  };
}

export function sshTransport(
  sessionId: string,
  hostId: string,
  attempt: number,
): TerminalTransport {
  return streamTransport(
    ({ cols, rows }, onEvent) =>
      ipc.ssh.connect({ sessionId, attempt, hostId, cols, rows, onEvent }),
    sshOperations(sessionId, attempt),
  );
}

export function sshAdhocTransport(
  sessionId: string,
  attempt: number,
  target: { host: string; port: number; username: string },
): TerminalTransport {
  return streamTransport(
    ({ cols, rows }, onEvent) =>
      ipc.ssh.connectAdhoc({
        sessionId,
        attempt,
        ...target,
        cols,
        rows,
        onEvent,
      }),
    sshOperations(sessionId, attempt),
  );
}

export function localTransport(
  sessionId: string,
  attempt: number,
): TerminalTransport {
  return streamTransport(
    ({ cols, rows }, onEvent) =>
      ipc.pty.open({ sessionId, attempt, cols, rows, onEvent }),
    {
      send: (data) => ipc.pty.write(sessionId, attempt, data),
      resize: (cols, rows) => ipc.pty.resize(sessionId, attempt, cols, rows),
      disconnect: () => ipc.pty.close(sessionId, attempt),
    },
  );
}
