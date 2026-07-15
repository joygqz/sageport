import { create } from "zustand";

import { useTerminalSearch } from "@/features/terminal/search";
import { disposeSession, getSession } from "@/features/terminal/sessions";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, SshStatusKind } from "@/types/models";
import {
  layoutExtent,
  layoutPaneIds,
  leafLayout,
  neighborPaneId,
  removeLayoutPane,
  resizeSplitNode,
  splitLayout,
  type PaneLayout,
  type SplitDirection,
} from "./pane-layout";

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

export type TerminalStatus = SshStatusKind | "idle";

export type TerminalTarget = "ssh" | "local" | "ssh-adhoc";

export type SendToTerminalResult = "sent" | "no-terminal" | "not-connected";

export type PaneSplitDirection = "right" | "down";

export const MAX_TERMINAL_SESSIONS = 10;
export const MAX_FILE_TABS = 10;
export const MAX_PANES_PER_DIRECTION: Record<SplitDirection, number> = {
  row: 3,
  column: 2,
};

export interface AdhocTarget {
  host: string;
  port: number;
  username: string;
}

export interface TerminalPane {
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

export interface TerminalTab {
  kind: "terminal";

  id: string;
  panes: TerminalPane[];
  layout: PaneLayout;
  activePaneId: string;
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

  lastPaneId: string | null;

  openTerminal: (host: Pick<Host, "id" | "label">) => string | null;

  openLocalTerminal: () => string | null;

  openAdhocTerminal: (target: AdhocTarget) => string | null;

  splitPane: (paneId: string, direction: PaneSplitDirection) => string | null;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  focusPaneNext: (direction: 1 | -1) => void;
  resizePanes: (tabId: string, splitId: string, sizes: number[]) => void;

  openFile: (file: {
    connectionId: string | null;
    path: string;
    name: string;
  }) => void;
  updateFileContent: (id: string, content: string) => void;

  saveFile: (id: string) => Promise<boolean>;

  pendingCloseId: string | null;
  clearPendingClose: () => void;
  pendingWindowClose: boolean;
  requestWindowClose: () => boolean;
  clearPendingWindowClose: () => void;

  close: (id: string, opts?: { force?: boolean }) => void;
  moveTab: (id: string, toIndex: number) => void;
  setActive: (id: string) => void;
  activateNext: (direction: 1 | -1) => void;

  setTerminalStatus: (
    paneId: string,
    status: TerminalStatus,
    error?: string,
    errorCode?: string | null,
  ) => void;

  reconnectTerminal: (paneId: string) => void;

  sendToTerminal: (command: string) => SendToTerminalResult;
}

const isTerminal = (tab: EditorTab): tab is TerminalTab =>
  tab.kind === "terminal";

export function terminalTabs(tabs: readonly EditorTab[]): TerminalTab[] {
  return tabs.filter(isTerminal);
}

export function terminalPanes(tabs: readonly EditorTab[]): TerminalPane[] {
  return terminalTabs(tabs).flatMap((tab) => tab.panes);
}

export function findPane(
  tabs: readonly EditorTab[],
  paneId: string | null,
): TerminalPane | undefined {
  if (!paneId) return undefined;
  return terminalPanes(tabs).find((pane) => pane.id === paneId);
}

export function paneTab(
  tabs: readonly EditorTab[],
  paneId: string | null,
): TerminalTab | undefined {
  if (!paneId) return undefined;
  return terminalTabs(tabs).find((tab) =>
    tab.panes.some((pane) => pane.id === paneId),
  );
}

export function activePane(tab: TerminalTab): TerminalPane {
  return (
    tab.panes.find((pane) => pane.id === tab.activePaneId) ?? tab.panes[0]
  );
}

export function tabTitle(tab: EditorTab): string {
  return tab.kind === "file" ? tab.title : activePane(tab).title;
}

function fileTabCount(tabs: EditorTab[]): number {
  return tabs.filter((tab) => tab.kind === "file").length;
}

function closestPaneId(tabs: EditorTab[], closedIndex: number) {
  if (tabs.length === 0) return null;

  const rightStart = Math.max(0, Math.min(closedIndex, tabs.length - 1));
  for (let i = rightStart; i < tabs.length; i++) {
    const tab = tabs[i];
    if (isTerminal(tab)) return tab.activePaneId;
  }
  const leftStart = Math.min(closedIndex - 1, tabs.length - 1);
  for (let i = leftStart; i >= 0; i--) {
    const tab = tabs[i];
    if (isTerminal(tab)) return tab.activePaneId;
  }
  return null;
}

export function targetPaneId(state: {
  tabs: EditorTab[];
  activeId: string | null;
  lastPaneId: string | null;
}): string | null {
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  if (active && isTerminal(active)) return activePane(active).id;
  return findPane(state.tabs, state.lastPaneId)?.id ?? null;
}

function localPaneTitle(tabs: EditorTab[]): string {
  const count = terminalPanes(tabs).filter(
    (pane) => pane.target === "local",
  ).length;
  return count === 0
    ? t("terminal.local.title")
    : `${t("terminal.local.title")} ${count + 1}`;
}

export const useTabsStore = create<TabsState>((set, get) => {
  const canOpenSession = () => {
    if (terminalPanes(get().tabs).length < MAX_TERMINAL_SESSIONS) return true;
    toast.warning(t("editor.tabLimitReached", { count: MAX_TERMINAL_SESSIONS }));
    return false;
  };

  const releasePane = (pane: TerminalPane) => {
    if (pane.target === "local") void ipc.pty.close(pane.id).catch(() => {});
    else void ipc.ssh.disconnect(pane.id, pane.attempt).catch(() => {});
    disposeSession(pane.id);
    const search = useTerminalSearch.getState();
    if (search.openFor === pane.id) search.close();
  };

  const openTab = (pane: TerminalPane): string => {
    const tab: TerminalTab = {
      kind: "terminal",
      id: crypto.randomUUID(),
      panes: [pane],
      layout: leafLayout(pane.id),
      activePaneId: pane.id,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeId: tab.id,
      lastPaneId: pane.id,
    }));
    return pane.id;
  };

  const patchPane = (paneId: string, patch: Partial<TerminalPane>) =>
    set((s) => ({
      tabs: s.tabs.map((tab) =>
        isTerminal(tab) && tab.panes.some((pane) => pane.id === paneId)
          ? {
              ...tab,
              panes: tab.panes.map((pane) =>
                pane.id === paneId ? { ...pane, ...patch } : pane,
              ),
            }
          : tab,
      ),
    }));

  const patchFile = (id: string, patch: Partial<FileTab>) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === "file" ? { ...t, ...patch } : t,
      ),
    }));

  const closeTab = (tab: EditorTab, opts?: { force?: boolean }) => {
    if (!opts?.force && tab.kind === "file" && isFileDirty(tab)) {
      set({ pendingCloseId: tab.id });
      return;
    }
    if (isTerminal(tab)) {
      for (const pane of tab.panes) releasePane(pane);
    }
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === tab.id);
      if (index === -1) return s;
      const tabs = s.tabs.filter((t) => t.id !== tab.id);

      const activeId =
        s.activeId === tab.id
          ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
          : tabs.some((t) => t.id === s.activeId)
            ? s.activeId
            : null;
      const active = tabs.find((t) => t.id === activeId);
      const lastPaneId =
        findPane(tabs, s.lastPaneId)?.id ??
        (active && isTerminal(active)
          ? active.activePaneId
          : closestPaneId(tabs, index));
      return { tabs, activeId, lastPaneId };
    });
  };

  return {
    tabs: [],
    activeId: null,
    lastPaneId: null,
    pendingCloseId: null,
    pendingWindowClose: false,

    clearPendingClose: () => set({ pendingCloseId: null }),
    requestWindowClose: () => {
      const shouldBlock = get().tabs.some(
        (tab) => tab.kind === "file" && isFileDirty(tab),
      );
      set({ pendingWindowClose: shouldBlock });
      return shouldBlock;
    },
    clearPendingWindowClose: () => set({ pendingWindowClose: false }),

    openTerminal: (host) => {
      if (!canOpenSession()) return null;
      return openTab({
        id: crypto.randomUUID(),
        target: "ssh",
        hostId: host.id,
        title: host.label,
        status: "idle",
        attempt: 0,
      });
    },

    openLocalTerminal: () => {
      if (!canOpenSession()) return null;
      return openTab({
        id: crypto.randomUUID(),
        target: "local",
        hostId: "",
        title: localPaneTitle(get().tabs),
        status: "idle",
        attempt: 0,
      });
    },

    openAdhocTerminal: (target) => {
      if (!canOpenSession()) return null;
      return openTab({
        id: crypto.randomUUID(),
        target: "ssh-adhoc",
        hostId: "",
        adhoc: target,
        title: `${target.username}@${target.host}`,
        status: "idle",
        attempt: 0,
      });
    },

    splitPane: (paneId, direction) => {
      const tab = paneTab(get().tabs, paneId);
      const source = tab?.panes.find((pane) => pane.id === paneId);
      if (!tab || !source) return null;
      const splitDirection: SplitDirection =
        direction === "right" ? "row" : "column";
      const newPaneId = crypto.randomUUID();
      const layout = splitLayout(tab.layout, paneId, newPaneId, splitDirection);
      const limit = MAX_PANES_PER_DIRECTION[splitDirection];
      if (layoutExtent(layout, splitDirection) > limit) {
        toast.warning(
          t(
            splitDirection === "row"
              ? "terminal.splitLimitReachedRow"
              : "terminal.splitLimitReachedColumn",
            { count: limit },
          ),
        );
        return null;
      }
      if (!canOpenSession()) return null;
      const pane: TerminalPane = {
        id: newPaneId,
        target: source.target,
        hostId: source.hostId,
        adhoc: source.adhoc,
        title:
          source.target === "local" ? localPaneTitle(get().tabs) : source.title,
        status: "idle",
        attempt: 0,
      };
      set((s) => ({
        tabs: s.tabs.map((current) => {
          if (current.id !== tab.id || !isTerminal(current)) return current;
          const at = current.panes.findIndex((item) => item.id === paneId) + 1;
          return {
            ...current,
            panes: [
              ...current.panes.slice(0, at),
              pane,
              ...current.panes.slice(at),
            ],
            layout,
            activePaneId: pane.id,
          };
        }),
        activeId: tab.id,
        lastPaneId: pane.id,
      }));
      return pane.id;
    },

    closePane: (paneId) => {
      const tab = paneTab(get().tabs, paneId);
      const pane = tab?.panes.find((item) => item.id === paneId);
      if (!tab || !pane) return;
      if (tab.panes.length === 1) {
        closeTab(tab);
        return;
      }
      const neighbor = neighborPaneId(tab.layout, paneId);
      releasePane(pane);
      set((s) => ({
        tabs: s.tabs.map((current) => {
          if (current.id !== tab.id || !isTerminal(current)) return current;
          const layout = removeLayoutPane(current.layout, paneId);
          if (!layout) return current;
          return {
            ...current,
            panes: current.panes.filter((item) => item.id !== paneId),
            layout,
            activePaneId:
              current.activePaneId === paneId
                ? (neighbor ?? current.panes[0].id)
                : current.activePaneId,
          };
        }),
        lastPaneId: s.lastPaneId === paneId ? neighbor : s.lastPaneId,
      }));
    },

    focusPane: (paneId) => {
      const tab = paneTab(get().tabs, paneId);
      if (!tab) return;
      set((s) => ({
        tabs: s.tabs.map((current) =>
          current.id === tab.id && isTerminal(current)
            ? { ...current, activePaneId: paneId }
            : current,
        ),
        activeId: tab.id,
        lastPaneId: paneId,
      }));
    },

    focusPaneNext: (direction) => {
      const { tabs, activeId, focusPane } = get();
      const active = tabs.find((tab) => tab.id === activeId);
      if (!active || !isTerminal(active) || active.panes.length < 2) return;
      const ids = layoutPaneIds(active.layout);
      const index = ids.indexOf(active.activePaneId);
      const next =
        ids[(Math.max(index, 0) + direction + ids.length) % ids.length];
      if (next) focusPane(next);
    },

    resizePanes: (tabId, splitId, sizes) =>
      set((s) => ({
        tabs: s.tabs.map((tab) =>
          tab.id === tabId && isTerminal(tab)
            ? { ...tab, layout: resizeSplitNode(tab.layout, splitId, sizes) }
            : tab,
        ),
      })),

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
      if (fileTabCount(get().tabs) >= MAX_FILE_TABS) {
        toast.warning(
          t("editor.fileTabLimitReached", { count: MAX_FILE_TABS }),
        );
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
        await ipc.sftp.writeText(
          tab.connectionId,
          tab.path,
          content,
          tab.savedContent,
        );
        patchFile(id, { saving: false, savedContent: content });
        const current = get().tabs.find(
          (item): item is FileTab => item.id === id && item.kind === "file",
        );
        return Boolean(current && !isFileDirty(current));
      } catch (err) {
        patchFile(id, { saving: false });
        toast.error(t("sftp.editor.saveError"), errorMessage(err));
        return false;
      }
    },

    close: (id, opts) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (tab) {
        closeTab(tab, opts);
        return;
      }
      if (findPane(get().tabs, id)) get().closePane(id);
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
        if (tab) {
          return {
            activeId: id,
            lastPaneId: isTerminal(tab) ? tab.activePaneId : s.lastPaneId,
          };
        }
        const owner = paneTab(s.tabs, id);
        if (!owner) return s;
        return {
          tabs: s.tabs.map((current) =>
            current.id === owner.id && isTerminal(current)
              ? { ...current, activePaneId: id }
              : current,
          ),
          activeId: owner.id,
          lastPaneId: id,
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

    setTerminalStatus: (paneId, status, error, errorCode) =>
      patchPane(paneId, { status, error, errorCode }),

    reconnectTerminal: (paneId) => {
      const pane = findPane(get().tabs, paneId);
      if (!pane) return;
      patchPane(paneId, {
        status: "connecting",
        error: undefined,
        errorCode: undefined,
        attempt: pane.attempt + 1,
      });
    },

    sendToTerminal: (command) => {
      const id = targetPaneId(get());
      const pane = findPane(get().tabs, id);
      const session = getSession(id);
      if (!id || !pane || !session) return "no-terminal";
      if (pane.status !== "connected") return "not-connected";
      session.sendCommand(command);
      void ipc.history
        .add(pane.target === "ssh" ? pane.hostId : null, command)
        .catch(() => {});
      get().setActive(id);
      return "sent";
    },
  };
});
