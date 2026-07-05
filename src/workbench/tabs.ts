import { create } from "zustand";

import { useTerminalSearch } from "@/features/terminal/search";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, SshStatusKind } from "@/types/models";

/**
 * The editor area's tab model. Terminal sessions, text files opened from the
 * files panel, and the settings page are all tabs, so one strip owns
 * ordering, activation and closing for everything that renders in the main
 * area (the VSCode editor-group model).
 */

/** Imperative translation helper — this store lives outside React. */
function t(key: Parameters<typeof translate>[1]): string {
  return translate(detectLocale(), key);
}

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

/** A text file opened from the files panel, edited in place (VSCode-style). */
export interface FileTab {
  kind: "file";
  id: string;
  /** SFTP connection id owning the file; `null` targets the local FS. */
  connectionId: string | null;
  path: string;
  /** File name, shown as the tab title. */
  title: string;
  /** Editor buffer; `null` until the file finishes loading. */
  content: string | null;
  /** Content as last loaded/saved, for dirty tracking. */
  savedContent: string | null;
  loadError?: string;
  saving: boolean;
}

export type EditorTab = TerminalTab | SettingsTab | FileTab;

export function isFileDirty(tab: FileTab): boolean {
  return tab.content !== null && tab.content !== tab.savedContent;
}

export const SETTINGS_TAB_ID = "settings";

interface TabsState {
  tabs: EditorTab[];
  activeId: string | null;
  /** Most recently active terminal tab; the target for snippets and AI. */
  lastTerminalId: string | null;

  /** Open a new terminal tab for a host and make it active. */
  openTerminal: (host: Pick<Host, "id" | "label">) => string;
  /** Open a file in an editor tab (or focus it if already open). */
  openFile: (file: {
    connectionId: string | null;
    path: string;
    name: string;
  }) => void;
  updateFileContent: (id: string, content: string) => void;
  /** Persist a file tab's buffer. Resolves `true` on success. */
  saveFile: (id: string) => Promise<boolean>;
  /**
   * A dirty file tab whose close was requested; the editor area watches this
   * and asks save / discard / cancel before calling `close` with `force`.
   */
  pendingCloseId: string | null;
  clearPendingClose: () => void;
  /** Open (or focus) the settings tab, optionally jumping to a section. */
  openSettings: (section?: SettingsSection) => void;
  setSettingsSection: (section: SettingsSection) => void;
  close: (id: string, opts?: { force?: boolean }) => void;
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

export const useTabsStore = create<TabsState>((set, get) => {
  const patchFile = (id: string, patch: Partial<FileTab>) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === "file" ? { ...t, ...patch } : t,
      ),
    }));

  return {
    tabs: [],
    activeId: null,
    lastTerminalId: null,
    pendingCloseId: null,

    clearPendingClose: () => set({ pendingCloseId: null }),

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

    openFile: ({ connectionId, path, name }) => {
      const existing = get().tabs.find(
        (t) =>
          t.kind === "file" &&
          t.connectionId === connectionId &&
          t.path === path,
      );
      if (existing) {
        get().setActive(existing.id);
        return;
      }
      const id = crypto.randomUUID();
      const tab: FileTab = {
        kind: "file",
        id,
        connectionId,
        path,
        title: name,
        content: null,
        savedContent: null,
        saving: false,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
      ipc.sftp.readText(connectionId, path).then(
        (text) => patchFile(id, { content: text, savedContent: text }),
        (err: unknown) => patchFile(id, { loadError: errorMessage(err) }),
      );
    },

    updateFileContent: (id, content) => patchFile(id, { content }),

    saveFile: async (id) => {
      const tab = get().tabs.find(
        (t): t is FileTab => t.id === id && t.kind === "file",
      );
      if (!tab || tab.content === null || tab.saving) return false;
      const content = tab.content;
      patchFile(id, { saving: true });
      try {
        await ipc.sftp.writeText(tab.connectionId, tab.path, content);
        patchFile(id, { saving: false, savedContent: content });
        return true;
      } catch (err) {
        patchFile(id, { saving: false });
        toast.error(t("sftp.editor.saveError"), errorMessage(err));
        return false;
      }
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
        tabs: s.tabs.map((t) =>
          t.kind === "settings" ? { ...t, section } : t,
        ),
      })),

    close: (id, opts) => {
      const tab = get().tabs.find((t) => t.id === id);
      // Deflect a dirty file close into the save/discard prompt.
      if (!opts?.force && tab?.kind === "file" && isFileDirty(tab)) {
        set({ pendingCloseId: id });
        return;
      }
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
  };
});
