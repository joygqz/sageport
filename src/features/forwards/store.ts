import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { ForwardStatusKind } from "@/types/models";

interface ForwardRuntime {
  status: ForwardStatusKind;
  message?: string;
}

interface ForwardState {
  runtime: Record<string, ForwardRuntime>;
  set: (id: string, runtime: ForwardRuntime) => void;
  hydrate: () => void;
}

export const useForwardStore = create<ForwardState>((set) => ({
  runtime: {},
  set: (id, runtime) =>
    set((s) => ({ runtime: { ...s.runtime, [id]: runtime } })),
  hydrate: () => {
    void ipc.forwards.active().then((ids) => {
      set((s) => {
        const runtime = { ...s.runtime };
        for (const id of ids) runtime[id] = { status: "active" };
        return { runtime };
      });
    });
  },
}));

let bridged = false;

export function bridgeForwardEvents() {
  if (bridged) return;
  bridged = true;
  void ipc.forwards.onStatus((event) => {
    useForwardStore.getState().set(event.forwardId, {
      status: event.status,
      message: event.message,
    });
  });
  useForwardStore.getState().hydrate();
}
