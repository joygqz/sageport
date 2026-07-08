import { create } from "zustand";

import { useTerminalSearch } from "@/features/terminal/search";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, SshStatusKind } from "@/types/models";

function t(key: Parameters<typeof translate>[1]): string {
  return translate(detectLocale(), key);
}

export type TerminalStatus = SshStatusKind | "idle";

export type TerminalTarget = "ssh" | "local" | "ssh-adhoc";

export interface AdhocTarget {
  host: string;
  port: number;
  username: string;
}

export type SettingsSection = "appearance" | "ai" | "sync" | "about";

export interface TerminalTab {
  kind: "terminal";

  id: string;
  target: TerminalTarget;
  hostId: string;
  adhoc?: AdhocTarget;
  title: string;
  status: TerminalStatus;
  error?: string;

  attempt: number;
}

export interface SettingsTab {
  kind: "settings";
  id: typeof SETTINGS_TAB_ID;
  section: SettingsSection;
}

export interface FileTab {
  kind: "file";
  id: string;

  connectionId: string | null;
  path: string;

  title: string;

  content: string | null;

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

  lastTerminalId: string | null;

  openTerminal: (host: Pick<Host, "id" | "label">) => string;

  openLocalTerminal: () => string;

  openAdhocTerminal: (target: AdhocTarget) => string;

  openFile: (file: {
    connectionId: string | null;
    path: string;
    name: string;
  }) => void;
  updateFileContent: (id: string, content: string) => void;

  saveFile: (id: string) => Promise<boolean>;

  pendingCloseId: string | null;
  clearPendingClose: () => void;

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

  reconnectTerminal: (id: string) => void;

  sendToTerminal: (command: string) => boolean;
}

const isTerminal = (tab: EditorTab): tab is TerminalTab =>
  tab.kind === "terminal";

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
        target: "ssh",
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

    openLocalTerminal: () => {
      const id = crypto.randomUUID();
      const count = terminalTabs(get().tabs).filter(
        (t) => t.target === "local",
      ).length;
      const tab: TerminalTab = {
        kind: "terminal",
        id,
        target: "local",
        hostId: "",
        title:
          count === 0
            ? t("terminal.local.title")
            : `${t("terminal.local.title")} ${count + 1}`,
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

    openAdhocTerminal: (target) => {
      const id = crypto.randomUUID();
      const tab: TerminalTab = {
        kind: "terminal",
        id,
        target: "ssh-adhoc",
        hostId: "",
        adhoc: target,
        title: `${target.username}@${target.host}`,
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

      if (!opts?.force && tab?.kind === "file" && isFileDirty(tab)) {
        set({ pendingCloseId: id });
        return;
      }
      if (tab && isTerminal(tab)) {
        if (tab.target === "local")
          void ipc.pty.close(id).catch(() => {});
        else void ipc.ssh.disconnect(id).catch(() => {});
        const search = useTerminalSearch.getState();
        if (search.openFor === id) search.close();
      }
      set((s) => {
        const index = s.tabs.findIndex((t) => t.id === id);
        if (index === -1) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);

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
      const tab = get().tabs.find((t): t is TerminalTab => t.id === id);
      const data = command + "\n";
      if (tab?.target === "local") void ipc.pty.write(id, data).catch(() => {});
      else void ipc.ssh.send(id, data).catch(() => {});
      get().setActive(id);
      return true;
    },
  };
});
