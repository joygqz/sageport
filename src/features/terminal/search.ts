import { create } from "zustand";

interface TerminalSearchState {
  openFor: string | null;
  open: (sessionId: string) => void;
  close: () => void;
}

export const useTerminalSearch = create<TerminalSearchState>((set) => ({
  openFor: null,
  open: (sessionId) => set({ openFor: sessionId }),
  close: () => set({ openFor: null }),
}));
