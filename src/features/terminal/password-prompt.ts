import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { PasswordPromptEvent } from "@/types/models";

interface PasswordPromptState {
  queue: PasswordPromptEvent[];
  push: (event: PasswordPromptEvent) => void;
  dismiss: (promptId: string) => void;
  respond: (promptId: string, password: string | null) => void;
  cancelSession: (sessionId: string) => void;
}

export const usePasswordPromptStore = create<PasswordPromptState>(
  (set, get) => ({
    queue: [],

    push: (event) =>
      set((state) =>
        state.queue.some((item) => item.promptId === event.promptId)
          ? state
          : { queue: [...state.queue, event] },
      ),

    dismiss: (promptId) =>
      set((state) => ({
        queue: state.queue.filter((event) => event.promptId !== promptId),
      })),

    respond: (promptId, password) => {
      const prompt = get().queue.find((event) => event.promptId === promptId);
      if (!prompt) return;
      set((state) => ({
        queue: state.queue.filter((event) => event.promptId !== promptId),
      }));
      void ipc.ssh.respondPassword(promptId, password).catch(() => {
        set((state) =>
          state.queue.some((event) => event.promptId === promptId)
            ? state
            : { queue: [prompt, ...state.queue] },
        );
      });
    },

    cancelSession: (sessionId) => {
      const { queue, respond } = get();
      for (const event of queue) {
        if (event.sessionId === sessionId) respond(event.promptId, null);
      }
    },
  }),
);

export async function listenPasswordPrompts(): Promise<() => void> {
  let syncing = true;
  const closedDuringSync = new Set<string>();
  const [unlistenPrompt, unlistenClosed] = await Promise.all([
    ipc.ssh.onPassword((event) =>
      usePasswordPromptStore.getState().push(event),
    ),
    ipc.ssh.onPasswordClosed((event) => {
      if (syncing) closedDuringSync.add(event.promptId);
      usePasswordPromptStore.getState().dismiss(event.promptId);
    }),
  ]);

  try {
    const pending = await ipc.ssh.pendingPasswords();
    for (const event of pending) {
      if (!closedDuringSync.has(event.promptId)) {
        usePasswordPromptStore.getState().push(event);
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

export function hasPasswordPrompt(sessionId: string): boolean {
  return usePasswordPromptStore
    .getState()
    .queue.some((event) => event.sessionId === sessionId);
}
