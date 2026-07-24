import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import type { ForwardStatusEvent, ForwardStatusKind } from "@/types/models";

interface ForwardRuntime {
  status: ForwardStatusKind;
  message?: string;
  code?: string;
  generation: number;
  sequence: number;
  publicBindRestricted: boolean;
}

interface ForwardState {
  runtime: Record<string, ForwardRuntime>;
  apply: (event: ForwardStatusEvent) => void;
  hydrate: (events: ForwardStatusEvent[]) => void;
  remove: (id: string) => void;
}

function fromEvent(event: ForwardStatusEvent): ForwardRuntime {
  return {
    status: event.status,
    message: event.message,
    code: event.code,
    generation: event.generation,
    sequence: event.sequence,
    publicBindRestricted: event.publicBindRestricted,
  };
}

export const useForwardStore = create<ForwardState>((set) => ({
  runtime: {},
  apply: (event) =>
    set((state) => {
      const current = state.runtime[event.forwardId];
      if (current && current.sequence >= event.sequence) return state;
      return {
        runtime: {
          ...state.runtime,
          [event.forwardId]: fromEvent(event),
        },
      };
    }),
  hydrate: (events) =>
    set({
      runtime: Object.fromEntries(
        events.map((event) => [event.forwardId, fromEvent(event)]),
      ),
    }),
  remove: (id) =>
    set((state) => {
      if (!(id in state.runtime)) return state;
      const runtime = { ...state.runtime };
      delete runtime[id];
      return { runtime };
    }),
}));

let bridgePromise: Promise<void> | null = null;

export function bridgeForwardEvents(): Promise<void> {
  if (bridgePromise) return bridgePromise;
  bridgePromise = (async () => {
    let syncing = true;
    const queued: ForwardStatusEvent[] = [];
    await ipc.forwards.onStatus((event) => {
      if (syncing) queued.push(event);
      else useForwardStore.getState().apply(event);
    });

    try {
      const snapshot = await ipc.forwards.runtime();
      useForwardStore.getState().hydrate(snapshot);
    } catch {
    } finally {
      for (const event of queued) useForwardStore.getState().apply(event);
      syncing = false;
    }
  })().catch((error) => {
    bridgePromise = null;
    throw error;
  });
  return bridgePromise;
}
