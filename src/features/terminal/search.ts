import { create } from "zustand";

interface TerminalSearchState {
  openFor: string | null;
  requestId: number;
  open: (sessionId: string) => void;
  close: () => void;
}

export const useTerminalSearch = create<TerminalSearchState>((set) => ({
  openFor: null,
  requestId: 0,
  open: (sessionId) =>
    set((state) => ({ openFor: sessionId, requestId: state.requestId + 1 })),
  close: () => set({ openFor: null }),
}));
