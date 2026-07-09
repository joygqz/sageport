import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { HostKeyDecision, HostKeyEvent } from "@/types/models";

interface HostKeyState {
  queue: HostKeyEvent[];
  push: (event: HostKeyEvent) => void;
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

  respond: (promptId, decision) => {
    if (!get().queue.some((e) => e.promptId === promptId)) return;
    void ipc.ssh.respondHostKey(promptId, decision).catch(() => {});
    set((s) => ({ queue: s.queue.filter((e) => e.promptId !== promptId) }));
  },

  rejectSession: (sessionId) => {
    const { queue, respond } = get();
    for (const event of queue) {
      if (event.sessionId === sessionId) respond(event.promptId, "reject");
    }
  },
}));

export function listenHostKeyEvents(): Promise<() => void> {
  return ipc.ssh.onHostKey((event) => useHostKeyStore.getState().push(event));
}

export function hasHostKeyPrompt(sessionId: string): boolean {
  return useHostKeyStore
    .getState()
    .queue.some((e) => e.sessionId === sessionId);
}
