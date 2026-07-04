import { create } from "zustand";

import { useTerminalSearch } from "@/features/terminal/search";
import { ipc } from "@/lib/ipc";
import type { Host, SshStatusKind } from "@/types/models";

/**
 * The editor area's tab model. Terminal sessions and the settings page are
 * both tabs, so one strip owns ordering, activation and closing for
 * everything that renders in the main area (the VSCode editor-group model).
 */

export type TerminalStatus = SshStatusKind | "idle";

export type SettingsSection = "appearance" | "ai" | "sync" | "about";

export interface TerminalTab {
  kind: "terminal";
  /** Tab id doubles as the backend SSH session id. */
  id: string;
  hostId: string;
  title: string;
  status: TerminalStatus;
  error?: string;
  /**
   * Incremented on each (re)connect request. The terminal view keys its
   * connection effect on this, so bumping it tears down the dead session
   * and starts a fresh handshake.
   */
  attempt: number;
}

export interface SettingsTab {
  kind: "settings";
  id: typeof SETTINGS_TAB_ID;
  section: SettingsSection;
}

export type EditorTab = TerminalTab | SettingsTab;

export const SETTINGS_TAB_ID = "settings";

interface TabsState {
  tabs: EditorTab[];
  activeId: string | null;
  /** Most recently active terminal tab; the target for snippets and AI. */
  lastTerminalId: string | null;

  /** Open a new terminal tab for a host and make it active. */
  openTerminal: (host: Pick<Host, "id" | "label">) => string;
  /** Open (or focus) the settings tab, optionally jumping to a section. */
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  close: (id: string) => void;
  setActive: (id: string) => void;
  activateNext: (direction: 1 | -1) => void;

  setTerminalStatus: (
    id: string,
    status: TerminalStatus,
    error?: string,
  ) => void;
  /** Retry a failed/closed session in place, reusing its tab and id. */
  reconnectTerminal: (id: string) => void;
  /** Send a command to the target terminal. Returns false if none exists. */
  sendToTerminal: (command: string) => boolean;
}

const isTerminal = (tab: EditorTab): tab is TerminalTab =>
  tab.kind === "terminal";

/** Terminal tabs only, for the AI tools and host indicators. */
export function terminalTabs(tabs: EditorTab[]): TerminalTab[] {
  return tabs.filter(isTerminal);
}

function findOpenTerminal(tabs: EditorTab[], id: string | null) {
  return tabs.find((t): t is TerminalTab => t.id === id && isTerminal(t));
}

function closestTerminalId(tabs: EditorTab[], closedIndex: number) {
  if (tabs.length === 0) return null;

  const rightStart = Math.max(0, Math.min(closedIndex, tabs.length - 1));
  for (let i = rightStart; i < tabs.length; i++) {
    if (isTerminal(tabs[i])) return tabs[i].id;
  }
  const leftStart = Math.min(closedIndex - 1, tabs.length - 1);
  for (let i = leftStart; i >= 0; i--) {
    if (isTerminal(tabs[i])) return tabs[i].id;
  }
  return null;
}

/** The terminal the user is working in: the active tab if it is a terminal,
 * otherwise the most recently active one. */
export function targetTerminalId(state: {
  tabs: EditorTab[];
  activeId: string | null;
  lastTerminalId: string | null;
}): string | null {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active && isTerminal(active)) return active.id;
  return findOpenTerminal(state.tabs, state.lastTerminalId)?.id ?? null;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  lastTerminalId: null,

  openTerminal: (host) => {
    const id = crypto.randomUUID();
    const tab: TerminalTab = {
      kind: "terminal",
      id,
      hostId: host.id,
      title: host.label,
      status: "idle",
      attempt: 0,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeId: id,
      lastTerminalId: id,
    }));
    return id;
  },

  openSettings: (section) => {
    const existing = get().tabs.find((t) => t.kind === "settings");
    if (existing) {
      set((s) => ({
        activeId: SETTINGS_TAB_ID,
        tabs: section
          ? s.tabs.map((t) => (t.kind === "settings" ? { ...t, section } : t))
          : s.tabs,
      }));
      return;
    }
    const tab: SettingsTab = {
      kind: "settings",
      id: SETTINGS_TAB_ID,
      section: section ?? "appearance",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: SETTINGS_TAB_ID }));
  },

  setSettingsSection: (section) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.kind === "settings" ? { ...t, section } : t)),
    })),

  close: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab && isTerminal(tab)) {
      void ipc.ssh.disconnect(id).catch(() => {});
      const search = useTerminalSearch.getState();
      if (search.openFor === id) search.close();
    }
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index === -1) return s;
      const tabs = s.tabs.filter((t) => t.id !== id);
      // Activate the neighbor on the right, falling back to the left.
      const activeId =
        s.activeId === id
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : tabs.some((t) => t.id === s.activeId)
            ? s.activeId
            : null;
      const active = tabs.find((t) => t.id === activeId);
      const lastTerminalId =
        findOpenTerminal(tabs, s.lastTerminalId)?.id ??
        (active && isTerminal(active)
          ? active.id
          : closestTerminalId(tabs, index));
      return { tabs, activeId, lastTerminalId };
    });
  },

  setActive: (id) =>
    set((s) => {
      const tab = s.tabs.find((t) => t.id === id);
      if (!tab) return s;
      return {
        activeId: id,
        lastTerminalId: isTerminal(tab) ? tab.id : s.lastTerminalId,
      };
    }),

  activateNext: (direction) => {
    const { tabs, activeId, setActive } = get();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    const next =
      index === -1
        ? tabs[direction === 1 ? 0 : tabs.length - 1]
        : tabs[(index + direction + tabs.length) % tabs.length];
    setActive(next.id);
  },

  setTerminalStatus: (id, status, error) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && isTerminal(t) ? { ...t, status, error } : t,
      ),
    })),

  reconnectTerminal: (id) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && isTerminal(t)
          ? {
              ...t,
              status: "connecting" as const,
              error: undefined,
              attempt: t.attempt + 1,
            }
          : t,
      ),
    })),

  sendToTerminal: (command) => {
    const id = targetTerminalId(get());
    if (!id) return false;
    void ipc.ssh.send(id, command + "\n").catch(() => {});
    get().setActive(id);
    return true;
  },
}));
