import type { UnlistenFn } from "@tauri-apps/api/event";

import { ipc } from "@/lib/ipc";
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

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sshLikeTransport(
  sessionId: string,
  attempt: number,
  connect: (dims: { cols: number; rows: number }) => Promise<void>,
): TerminalTransport {
  return {
    connect,
    send: (data) => ipc.ssh.send(sessionId, attempt, data),
    resize: (cols, rows) => ipc.ssh.resize(sessionId, attempt, cols, rows),
    disconnect: () => ipc.ssh.disconnect(sessionId, attempt),
    onData: (handler) =>
      ipc.ssh.onData((e) => {
        if (e.id === sessionId && e.attempt === attempt)
          handler(decodeBase64(e.data));
      }),
    onStatus: (handler) =>
      ipc.ssh.onStatus((e) => {
        if (e.id === sessionId && e.attempt === attempt)
          handler({ status: e.status, message: e.message, code: e.code });
      }),
  };
}

export function sshTransport(
  sessionId: string,
  hostId: string,
  attempt: number,
): TerminalTransport {
  return sshLikeTransport(sessionId, attempt, ({ cols, rows }) =>
    ipc.ssh.connect({ sessionId, attempt, hostId, cols, rows }),
  );
}

export function sshAdhocTransport(
  sessionId: string,
  attempt: number,
  target: { host: string; port: number; username: string },
): TerminalTransport {
  return sshLikeTransport(sessionId, attempt, ({ cols, rows }) =>
    ipc.ssh.connectAdhoc({ sessionId, attempt, ...target, cols, rows }),
  );
}

export function localTransport(sessionId: string): TerminalTransport {
  let onStatus: ((update: TerminalStatusUpdate) => void) | undefined;
  return {
    connect: async ({ cols, rows }) => {
      await ipc.pty.open({ sessionId, cols, rows });
      onStatus?.({ status: "connected" });
    },
    send: (data) => ipc.pty.write(sessionId, data),
    resize: (cols, rows) => ipc.pty.resize(sessionId, cols, rows),
    disconnect: () => ipc.pty.close(sessionId),
    onData: (handler) =>
      ipc.pty.onData((e) => {
        if (e.id === sessionId) handler(decodeBase64(e.data));
      }),
    onStatus: (handler) => {
      onStatus = handler;
      return ipc.pty.onExit((e) => {
        if (e.id === sessionId) handler({ status: "closed" });
      });
    },
  };
}
