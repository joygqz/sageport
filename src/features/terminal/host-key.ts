import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { HostKeyDecision, HostKeyEvent } from "@/types/models";

interface HostKeyState {
  queue: HostKeyEvent[];
  push: (event: HostKeyEvent) => void;
  dismiss: (promptId: string) => void;
  respond: (promptId: string, decision: HostKeyDecision) => void;
  rejectSession: (sessionId: string) => void;
}

export const useHostKeyStore = create<HostKeyState>((set, get) => ({
  queue: [],

  push: (event) =>
    set((s) =>
      s.queue.some((e) => e.promptId === event.promptId)
        ? s
        : { queue: [...s.queue, event] },
    ),

  dismiss: (promptId) =>
    set((state) => ({
      queue: state.queue.filter((event) => event.promptId !== promptId),
    })),

  respond: (promptId, decision) => {
    const prompt = get().queue.find((event) => event.promptId === promptId);
    if (!prompt) return;
    set((s) => ({ queue: s.queue.filter((e) => e.promptId !== promptId) }));
    void ipc.ssh.respondHostKey(promptId, decision).catch(() => {
      set((state) =>
        state.queue.some((event) => event.promptId === promptId)
          ? state
          : { queue: [prompt, ...state.queue] },
      );
    });
  },

  rejectSession: (sessionId) => {
    const { queue, respond } = get();
    for (const event of queue) {
      if (event.sessionId === sessionId) respond(event.promptId, "reject");
    }
  },
}));

export async function listenHostKeyEvents(): Promise<() => void> {
  let syncing = true;
  const closedDuringSync = new Set<string>();
  const [unlistenPrompt, unlistenClosed] = await Promise.all([
    ipc.ssh.onHostKey((event) => useHostKeyStore.getState().push(event)),
    ipc.ssh.onHostKeyClosed((event) => {
      if (syncing) closedDuringSync.add(event.promptId);
      useHostKeyStore.getState().dismiss(event.promptId);
    }),
  ]);
  try {
    const pending = await ipc.ssh.pendingHostKeys();
    for (const event of pending) {
      if (!closedDuringSync.has(event.promptId)) {
        useHostKeyStore.getState().push(event);
      }
    }
  } catch {
    // Live events remain authoritative if the recovery query is unavailable.
  } finally {
    syncing = false;
  }
  return () => {
    unlistenPrompt();
    unlistenClosed();
  };
}

export function hasHostKeyPrompt(sessionId: string): boolean {
  return useHostKeyStore
    .getState()
    .queue.some((e) => e.sessionId === sessionId);
}
