import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { Host, SshStatusKind } from "@/types/models";

export type SessionStatus = SshStatusKind | "idle";

export interface TerminalSession {
  /** Backend session id (one per tab). */
  id: string;
  hostId: string;
  title: string;
  status: SessionStatus;
  error?: string;
  /**
   * Incremented on each (re)connect request. The terminal view keys its
   * connection effect on this, so bumping it tears down the dead session and
   * starts a fresh handshake.
   */
  attempt: number;
}

interface SessionState {
  sessions: TerminalSession[];
  activeId: string | null;
  /** Open a new terminal tab for a host and make it active. */
  open: (host: Host) => string;
  close: (id: string) => void;
  setActive: (id: string) => void;
  setStatus: (id: string, status: SessionStatus, error?: string) => void;
  /** Retry a failed/closed session in place, reusing its tab and id. */
  reconnect: (id: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeId: null,

  open: (host) => {
    const id = crypto.randomUUID();
    const session: TerminalSession = {
      id,
      hostId: host.id,
      title: host.label,
      status: "idle",
      attempt: 0,
    };
    set((s) => ({ sessions: [...s.sessions, session], activeId: id }));
    return id;
  },

  close: (id) => {
    void ipc.ssh.disconnect(id).catch(() => {});
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeId =
        s.activeId === id
          ? (sessions[sessions.length - 1]?.id ?? null)
          : s.activeId;
      return { sessions, activeId };
    });
  },

  setActive: (id) => set({ activeId: id }),

  setStatus: (id, status, error) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, status, error } : x,
      ),
    })),

  reconnect: (id) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id
          ? {
              ...x,
              status: "connecting",
              error: undefined,
              attempt: x.attempt + 1,
            }
          : x,
      ),
    })),
}));
