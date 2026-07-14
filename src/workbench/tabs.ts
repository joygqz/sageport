import { create } from "zustand";

import { useTerminalSearch } from "@/features/terminal/search";
import { disposeSession, getSession } from "@/features/terminal/sessions";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, SshStatusKind } from "@/types/models";

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

export type TerminalStatus = SshStatusKind | "idle";

export type TerminalTarget = "ssh" | "local" | "ssh-adhoc";

export type SendToTerminalResult = "sent" | "no-terminal" | "not-connected";

export const MAX_TERMINAL_TABS = 10;

export interface AdhocTarget {
  host: string;
  port: number;
  username: string;
}

export interface TerminalTab {
  kind: "terminal";

  id: string;
  target: TerminalTarget;
  hostId: string;
  adhoc?: AdhocTarget;
  title: string;
  status: TerminalStatus;
  error?: string;
  errorCode?: string | null;

  attempt: number;
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

export type EditorTab = TerminalTab | FileTab;

export function isFileDirty(tab: FileTab): boolean {
  return tab.content !== null && tab.content !== tab.savedContent;
}

interface TabsState {
  tabs: EditorTab[];
  activeId: string | null;

  lastTerminalId: string | null;

  openTerminal: (host: Pick<Host, "id" | "label">) => string | null;

  openLocalTerminal: () => string | null;

  openAdhocTerminal: (target: AdhocTarget) => string | null;

  openFile: (file: {
    connectionId: string | null;
    path: string;
    name: string;
  }) => void;
  updateFileContent: (id: string, content: string) => void;

  saveFile: (id: string) => Promise<boolean>;

  pendingCloseId: string | null;
  clearPendingClose: () => void;

  close: (id: string, opts?: { force?: boolean }) => void;
  moveTab: (id: string, toIndex: number) => void;
  setActive: (id: string) => void;
  activateNext: (direction: 1 | -1) => void;

  setTerminalStatus: (
    id: string,
    status: TerminalStatus,
    error?: string,
    errorCode?: string | null,
  ) => void;

  reconnectTerminal: (id: string) => void;

  sendToTerminal: (command: string) => SendToTerminalResult;
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
  const canOpenTerminal = () => {
    if (terminalTabs(get().tabs).length < MAX_TERMINAL_TABS) return true;
    toast.warning(t("editor.tabLimitReached", { count: MAX_TERMINAL_TABS }));
    return false;
  };

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
      if (!canOpenTerminal()) return null;
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
      if (!canOpenTerminal()) return null;
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
      if (!canOpenTerminal()) return null;
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

    close: (id, opts) => {
      const tab = get().tabs.find((t) => t.id === id);

      if (!opts?.force && tab?.kind === "file" && isFileDirty(tab)) {
        set({ pendingCloseId: id });
        return;
      }
      if (tab && isTerminal(tab)) {
        if (tab.target === "local") void ipc.pty.close(id).catch(() => {});
        else void ipc.ssh.disconnect(id).catch(() => {});
        disposeSession(id);
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

    moveTab: (id, toIndex) =>
      set((s) => {
        const fromIndex = s.tabs.findIndex((tab) => tab.id === id);
        if (fromIndex === -1) return s;

        const nextIndex = Math.max(0, Math.min(toIndex, s.tabs.length - 1));
        if (fromIndex === nextIndex) return s;

        const tabs = [...s.tabs];
        const [tab] = tabs.splice(fromIndex, 1);
        if (!tab) return s;
        tabs.splice(nextIndex, 0, tab);
        return { tabs };
      }),

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

    setTerminalStatus: (id, status, error, errorCode) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id && isTerminal(t) ? { ...t, status, error, errorCode } : t,
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
                errorCode: undefined,
                attempt: t.attempt + 1,
              }
            : t,
        ),
      })),

    sendToTerminal: (command) => {
      const id = targetTerminalId(get());
      const tab = findOpenTerminal(get().tabs, id);
      const session = getSession(id);
      if (!id || !tab || !session) return "no-terminal";
      if (tab.status !== "connected") return "not-connected";
      session.sendCommand(command);
      get().setActive(id);
      return "sent";
    },
  };
});
