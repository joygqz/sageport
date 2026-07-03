import { create } from "zustand";

/**
 * Which terminal session (if any) has its find bar open. Kept outside the
 * component so the global mod+F keybinding can open it for the active tab.
 */
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
