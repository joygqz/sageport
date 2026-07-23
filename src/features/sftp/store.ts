import { create } from "zustand";

import { useHostKeyStore } from "@/features/terminal/host-key";
import { usePasswordPromptStore } from "@/features/terminal/password-prompt";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type {
  DeleteEvent,
  FileEntry,
  Host,
  SftpStatusKind,
  TransferEvent,
  TransferHistoryEntry,
} from "@/types/models";
import { transferHistoryKey } from "./api";
import {
  pendingTransfer,
  updateTransferProgress,
  type ActiveTransfer,
} from "./transfer-progress";
import { pushNavigationHistory } from "./navigation-history";

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

function describeConnectError(code?: string | null, message?: string) {
  if (code === "invalid") return t("ssh.credentialsMissing");
  if (code === "auth") return t("ssh.authFailed");
  if (code === "host_key") return t("ssh.hostKeyRejected");
  if (code === "cancelled") return t("terminal.connectCancelled");
  if (code === "network") return t("sftp.connectionLost");
  return message;
}

function describeNavigationError(
  code: string | null,
  path: string,
  message: string,
) {
  if (code === "not_found") return t("sftp.pathNotFound", { path });
  return message;
}

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;
export const MAX_SFTP_TABS = 10;

export type PaneSide = "left" | "right";
export type TabKind = "local" | "remote";
export type TabStatus = SftpStatusKind | "idle";

export interface SftpTab {
  id: string;
  kind: TabKind;

  connectionId: string | null;
  hostId?: string;
  title: string;
  cwd: string;
  navigationPath?: string;
  status: TabStatus;
  entries: FileEntry[];
  selected: string[];
  history: string[];
  historyIndex: number;
  loading: boolean;
  error?: string;
}

export interface ActiveDeleteOperation extends DeleteEvent {
  label: string;
  side: PaneSide;
  tabId: string;
  cancelRequested: boolean;
}

interface PaneState {
  tabs: SftpTab[];
  activeTabId: string | null;
}

interface SftpState {
  ratio: number;
  panes: Record<PaneSide, PaneState>;

  transfers: Record<string, ActiveTransfer>;
  deletions: Record<string, ActiveDeleteOperation>;

  showHidden: boolean;
  showFileToolbar: boolean;
  pendingConflict: {
    name: string;
    remaining: number;
    applyToRemaining: boolean;
  } | null;

  setRatio: (r: number) => void;
  toggleHidden: () => void;
  toggleFileToolbar: () => void;
  setConflictApplyToRemaining: (value: boolean) => void;
  resolveConflict: (decision: ConflictAction) => void;

  ensureLocalTab: (side: PaneSide) => Promise<void>;
  addLocalTab: (side: PaneSide) => Promise<void>;
  addRemoteTab: (side: PaneSide, host: Host) => void;
  reconnectTab: (side: PaneSide, tabId: string) => void;
  closeTab: (side: PaneSide, tabId: string) => void;
  moveTab: (side: PaneSide, tabId: string, toIndex: number) => void;
  setActive: (side: PaneSide, tabId: string) => void;

  navigate: (side: PaneSide, tabId: string, path: string) => Promise<void>;
  navigateToHistory: (
    side: PaneSide,
    tabId: string,
    historyIndex: number,
  ) => Promise<void>;
  restoreLoadedPath: (side: PaneSide, tabId: string) => void;
  refresh: (side: PaneSide, tabId: string) => Promise<void>;
  setSelected: (side: PaneSide, tabId: string, selected: string[]) => void;

  applyStatus: (
    connectionId: string,
    status: SftpStatusKind,
    message?: string,
    code?: string,
  ) => void;

  applyTransfer: (e: TransferEvent) => void;
  applyDelete: (e: DeleteEvent) => void;

  cancelTransfer: (transferId: string) => void;
  cancelDelete: (operationId: string) => void;

  transfer: (fromSide: PaneSide, entries?: FileEntry[]) => Promise<void>;
  deleteEntries: (
    side: PaneSide,
    tabId: string,
    entries: FileEntry[],
  ) => Promise<void>;
}

const otherSide = (side: PaneSide): PaneSide =>
  side === "left" ? "right" : "left";

type ConflictAction = "skip" | "rename" | "overwrite";
type ConflictDecision = { action: ConflictAction; applyToRemaining: boolean };

let conflictResolver: ((decision: ConflictDecision) => void) | null = null;

function uniqueCopyName(name: string, occupied: Set<string>): string {
  const dot = name.lastIndexOf(".");
  const hasExtension = dot > 0;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : "";
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem} (${index})${extension}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${stem} (${crypto.randomUUID()})${extension}`;
}

export function parentPath(path: string): string {
  const root =
    path.match(/^([A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/]?)/)?.[0] ??
    (path.startsWith("/") ? "/" : "");
  const trimmed = path.replace(/[/\\]+$/, "") || root || "/";
  if (trimmed === "/") return "/";
  if (root && trimmed.replace(/[/\\]+$/, "") === root.replace(/[/\\]+$/, "")) {
    return root;
  }
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < root.length) return root || trimmed;
  return trimmed.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const name = trimmed.split(/[/\\]/).pop();
  return name && name.length > 0 ? name : path;
}

export function isValidEntryName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("\0") &&
    new TextEncoder().encode(name).length <= 255
  );
}

const emptyPane = (): PaneState => ({ tabs: [], activeTabId: null });

let eventsBridged = false;
let eventBridgePromise: Promise<void> | null = null;

function syncTransferHistory(event: TransferEvent): void {
  const entries =
    queryClient.getQueryData<TransferHistoryEntry[]>(transferHistoryKey);
  if (!entries) return;

  const index = entries.findIndex((entry) => entry.id === event.transferId);
  if (index < 0) {
    if (event.status === "active" && event.phase === "preparing") {
      void queryClient.invalidateQueries({ queryKey: transferHistoryKey });
    }
    return;
  }

  queryClient.setQueryData<TransferHistoryEntry[]>(
    transferHistoryKey,
    entries.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            transferredBytes: event.transferred,
            totalBytes: event.total,
            status: event.status,
            message: event.message,
            finishedAt:
              event.status === "active"
                ? null
                : (entry.finishedAt ?? new Date().toISOString()),
          }
        : entry,
    ),
  );
}

export function bridgeSftpEvents(): Promise<void> {
  if (eventsBridged) return Promise.resolve();
  const { applyStatus, applyTransfer, applyDelete } = useSftpStore.getState();
  eventBridgePromise ??= (async () => {
    const unlistenStatus = await ipc.sftp.onStatus((e) =>
      applyStatus(e.connectionId, e.status, e.message, e.code),
    );
    let unlistenTransfer: (() => void) | undefined;
    try {
      unlistenTransfer = await ipc.sftp.onTransfer((e) => applyTransfer(e));
      await ipc.sftp.onDelete((e) => applyDelete(e));
      eventsBridged = true;
    } catch (error) {
      unlistenTransfer?.();
      unlistenStatus();
      throw error;
    }
  })().catch((error) => {
    eventBridgePromise = null;
    throw error;
  });
  return eventBridgePromise;
}

export const useSftpStore = create<SftpState>((set, get) => {
  const navigationRequests = new Map<string, number>();

  const canAddTab = (notify = true) => {
    const { left, right } = get().panes;
    if (left.tabs.length + right.tabs.length < MAX_SFTP_TABS) return true;
    if (notify) {
      toast.warning(t("sftp.tabLimitReached", { count: MAX_SFTP_TABS }));
    }
    return false;
  };

  const patchTab = (
    side: PaneSide,
    tabId: string,
    patch: Partial<SftpTab> | ((tab: SftpTab) => Partial<SftpTab>),
  ) =>
    set((s) => {
      const pane = s.panes[side];
      return {
        panes: {
          ...s.panes,
          [side]: {
            ...pane,
            tabs: pane.tabs.map((t) =>
              t.id === tabId
                ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) }
                : t,
            ),
          },
        },
      };
    });

  const findByConnection = (connectionId: string) => {
    const { panes } = get();
    for (const side of ["left", "right"] as PaneSide[]) {
      const tab = panes[side].tabs.find((t) => t.connectionId === connectionId);
      if (tab) return { side, tab };
    }
    return null;
  };

  const loadEntries = async (
    side: PaneSide,
    tabId: string,
    path: string,
    historyIndex?: number | null,
  ) => {
    const pane = get().panes[side];
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (
      tab.kind === "remote" &&
      (!path || tab.status === "closed" || tab.status === "error")
    ) {
      return;
    }
    const requestId = (navigationRequests.get(tabId) ?? 0) + 1;
    navigationRequests.set(tabId, requestId);
    const isCurrent = () => navigationRequests.get(tabId) === requestId;
    patchTab(side, tabId, {
      loading: true,
      error: undefined,
      navigationPath: path,
    });
    try {
      const entries = await ipc.sftp.list(tab.connectionId, path);
      if (!isCurrent()) return;
      patchTab(side, tabId, (current) => ({
        cwd: path,
        navigationPath: undefined,
        entries,
        selected: [],
        loading: false,
        ...(historyIndex === null
          ? null
          : historyIndex === undefined
            ? pushNavigationHistory(current, path)
            : { historyIndex }),
      }));
    } catch (err) {
      if (!isCurrent()) return;
      const code = errorCode(err);
      patchTab(side, tabId, {
        loading: false,
        ...(tab.kind === "remote" && code === "network"
          ? { status: "error" as const }
          : null),
        error: describeNavigationError(code, path, errorMessage(err)),
      });
    }
  };

  return {
    ratio: 0.5,
    panes: { left: emptyPane(), right: emptyPane() },
    transfers: {},
    deletions: {},
    pendingConflict: null,
    showHidden: false,
    showFileToolbar: false,

    setRatio: (r) => set({ ratio: Math.max(0, Math.min(r, 1)) }),

    toggleHidden: () => set((s) => ({ showHidden: !s.showHidden })),
    toggleFileToolbar: () =>
      set((state) => ({ showFileToolbar: !state.showFileToolbar })),
    setConflictApplyToRemaining: (applyToRemaining) =>
      set((state) => ({
        pendingConflict: state.pendingConflict
          ? { ...state.pendingConflict, applyToRemaining }
          : null,
      })),
    resolveConflict: (decision) => {
      const resolve = conflictResolver;
      const applyToRemaining = get().pendingConflict?.applyToRemaining ?? false;
      conflictResolver = null;
      set({ pendingConflict: null });
      resolve?.({ action: decision, applyToRemaining });
    },

    ensureLocalTab: async (side) => {
      if (get().panes[side].tabs.length > 0 || !canAddTab(false)) return;
      await get().addLocalTab(side);
    },

    addLocalTab: async (side) => {
      if (!canAddTab()) return;
      const id = crypto.randomUUID();
      const tab: SftpTab = {
        id,
        kind: "local",
        connectionId: null,
        title: "",
        cwd: "",
        status: "connected",
        entries: [],
        selected: [],
        history: [],
        historyIndex: -1,
        loading: true,
      };
      set((s) => ({
        panes: {
          ...s.panes,
          [side]: { tabs: [...s.panes[side].tabs, tab], activeTabId: id },
        },
      }));
      try {
        const home = await ipc.sftp.home(null);
        patchTab(side, id, { title: home, cwd: home });
        await loadEntries(side, id, home);
      } catch (err) {
        patchTab(side, id, { loading: false, error: errorMessage(err) });
      }
    },

    addRemoteTab: (side, host) => {
      if (!canAddTab()) return;
      const id = crypto.randomUUID();
      const tab: SftpTab = {
        id,
        kind: "remote",
        connectionId: id,
        hostId: host.id,
        title: host.label,
        cwd: "",
        status: "connecting",
        entries: [],
        selected: [],
        history: [],
        historyIndex: -1,
        loading: true,
      };
      set((s) => ({
        panes: {
          ...s.panes,
          [side]: { tabs: [...s.panes[side].tabs, tab], activeTabId: id },
        },
      }));
      void ipc.sftp.connect(id, host.id).catch((err) => {
        patchTab(side, id, {
          status: "error",
          loading: false,
          error: describeConnectError(errorCode(err), errorMessage(err)),
        });
      });
    },

    reconnectTab: (side, tabId) => {
      const tab = get().panes[side].tabs.find((item) => item.id === tabId);
      if (!tab || tab.kind !== "remote" || !tab.connectionId || !tab.hostId)
        return;
      patchTab(side, tabId, {
        status: "connecting",
        loading: true,
        error: undefined,
        cwd: "",
        entries: [],
        selected: [],
      });
      void ipc.sftp
        .disconnect(tab.connectionId)
        .catch(() => {})
        .then(() => ipc.sftp.connect(tab.connectionId!, tab.hostId!))
        .catch((err) => {
          patchTab(side, tabId, {
            status: "error",
            loading: false,
            error: describeConnectError(errorCode(err), errorMessage(err)),
          });
        });
    },

    closeTab: (side, tabId) => {
      const pane = get().panes[side];
      const tab = pane.tabs.find((t) => t.id === tabId);
      navigationRequests.delete(tabId);
      if (tab?.kind === "remote" && tab.connectionId) {
        for (const transfer of Object.values(get().transfers)) {
          if (
            transfer.sourceConnectionId === tab.connectionId ||
            transfer.destConnectionId === tab.connectionId
          ) {
            get().cancelTransfer(transfer.transferId);
          }
        }
        void ipc.sftp.disconnect(tab.connectionId).catch(() => {});
        useHostKeyStore.getState().rejectSession(tab.connectionId);
        usePasswordPromptStore.getState().cancelSession(tab.connectionId);
      }
      set((s) => {
        const tabs = s.panes[side].tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          s.panes[side].activeTabId === tabId
            ? (tabs[tabs.length - 1]?.id ?? null)
            : s.panes[side].activeTabId;
        return { panes: { ...s.panes, [side]: { tabs, activeTabId } } };
      });
    },

    moveTab: (side, tabId, toIndex) =>
      set((s) => {
        const pane = s.panes[side];
        const fromIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
        if (fromIndex === -1) return s;

        const nextIndex = Math.max(0, Math.min(toIndex, pane.tabs.length - 1));
        if (fromIndex === nextIndex) return s;

        const tabs = [...pane.tabs];
        const [tab] = tabs.splice(fromIndex, 1);
        if (!tab) return s;
        tabs.splice(nextIndex, 0, tab);
        return {
          panes: {
            ...s.panes,
            [side]: { ...pane, tabs },
          },
        };
      }),

    setActive: (side, tabId) =>
      set((s) => ({
        panes: { ...s.panes, [side]: { ...s.panes[side], activeTabId: tabId } },
      })),

    navigate: (side, tabId, path) => loadEntries(side, tabId, path),

    navigateToHistory: (side, tabId, historyIndex) => {
      const tab = get().panes[side].tabs.find((item) => item.id === tabId);
      const path = tab?.history[historyIndex];
      if (!tab || path === undefined || historyIndex === tab.historyIndex) {
        return Promise.resolve();
      }
      return loadEntries(side, tabId, path, historyIndex);
    },

    restoreLoadedPath: (side, tabId) => {
      navigationRequests.set(tabId, (navigationRequests.get(tabId) ?? 0) + 1);
      patchTab(side, tabId, {
        navigationPath: undefined,
        loading: false,
        error: undefined,
      });
    },

    refresh: (side, tabId) => {
      const tab = get().panes[side].tabs.find((t) => t.id === tabId);
      if (tab?.kind === "remote" && (tab.status !== "connected" || !tab.cwd)) {
        return Promise.resolve();
      }
      return tab ? loadEntries(side, tabId, tab.cwd, null) : Promise.resolve();
    },

    setSelected: (side, tabId, selected) => patchTab(side, tabId, { selected }),

    applyStatus: (connectionId, status, message, code) => {
      if (status === "error" || status === "closed") {
        useHostKeyStore.getState().rejectSession(connectionId);
        usePasswordPromptStore.getState().cancelSession(connectionId);
      }
      const found = findByConnection(connectionId);
      if (!found) return;
      const { side, tab } = found;

      if (status === "connected" && !tab.cwd) {
        void (async () => {
          let error: string | undefined;
          try {
            const home = await ipc.sftp.home(connectionId);
            await loadEntries(side, tab.id, home);
          } catch (err) {
            error = errorMessage(err);
          }

          const current = get().panes[side].tabs.find((x) => x.id === tab.id);
          if (!current || current.status !== "connecting") return;
          patchTab(side, tab.id, {
            status: "connected",
            loading: false,
            ...(error ? { error } : null),
          });
        })();
        return;
      }
      patchTab(side, tab.id, {
        status,

        ...(status === "error" ? { loading: false } : null),
        error:
          status === "error" ? describeConnectError(code, message) : message,
      });
    },

    applyTransfer: (e) => {
      syncTransferHistory(e);
      if (e.status === "active") {
        set((s) => ({
          transfers: {
            ...s.transfers,
            [e.transferId]: updateTransferProgress(
              s.transfers[e.transferId],
              e,
            ),
          },
        }));
        return;
      }

      const completed = get().transfers[e.transferId];
      set((s) => {
        const rest = { ...s.transfers };
        delete rest[e.transferId];
        return { transfers: rest };
      });
      if (e.status === "error") {
        toast.error(
          t("sftp.transferFailed"),
          e.code === "network" ? t("sftp.connectionLost") : e.message,
        );
        if (e.code === "network" && completed) {
          const affected = new Set(
            [completed.sourceConnectionId, completed.destConnectionId].filter(
              (id): id is string => Boolean(id),
            ),
          );
          set((s) => ({
            panes: Object.fromEntries(
              Object.entries(s.panes).map(([side, pane]) => [
                side,
                {
                  ...pane,
                  tabs: pane.tabs.map((tab) =>
                    tab.connectionId && affected.has(tab.connectionId)
                      ? {
                          ...tab,
                          status: "error" as const,
                          loading: false,
                          error: t("sftp.connectionLost"),
                        }
                      : tab,
                  ),
                },
              ]),
            ) as Record<PaneSide, PaneState>,
          }));
        }
      }

      if (completed?.destinationSide && completed.destinationTabId) {
        void get().refresh(
          completed.destinationSide,
          completed.destinationTabId,
        );
      }
    },

    applyDelete: (e) => {
      if (e.status === "active") {
        set((s) => {
          const operation = s.deletions[e.operationId];
          if (!operation) return s;
          return {
            deletions: {
              ...s.deletions,
              [e.operationId]: { ...operation, ...e },
            },
          };
        });
        return;
      }

      const completed = get().deletions[e.operationId];
      set((s) => {
        const rest = { ...s.deletions };
        delete rest[e.operationId];
        return { deletions: rest };
      });
      if (e.status === "error") {
        toast.error(
          t("sftp.deleteFailed"),
          e.code === "network" ? t("sftp.connectionLost") : e.message,
        );
        if (e.code === "network" && e.connectionId) {
          get().applyStatus(
            e.connectionId,
            "error",
            t("sftp.connectionLost"),
            "network",
          );
        }
      }
      if (completed) {
        void get().refresh(completed.side, completed.tabId);
      }
    },

    cancelTransfer: (transferId) => {
      set((s) => {
        const transfer = s.transfers[transferId];
        if (!transfer) return s;
        return {
          transfers: {
            ...s.transfers,
            [transferId]: { ...transfer, cancelRequested: true },
          },
        };
      });
      void ipc.sftp.cancelTransfer(transferId).catch((err) => {
        set((s) => {
          const transfer = s.transfers[transferId];
          if (!transfer) return s;
          return {
            transfers: {
              ...s.transfers,
              [transferId]: { ...transfer, cancelRequested: false },
            },
          };
        });
        toast.error(t("sftp.cancelError"), errorMessage(err));
      });
    },

    cancelDelete: (operationId) => {
      set((s) => {
        const operation = s.deletions[operationId];
        if (!operation) return s;
        return {
          deletions: {
            ...s.deletions,
            [operationId]: { ...operation, cancelRequested: true },
          },
        };
      });
      void ipc.sftp.cancelDelete(operationId).catch((err) => {
        set((s) => {
          const operation = s.deletions[operationId];
          if (!operation) return s;
          return {
            deletions: {
              ...s.deletions,
              [operationId]: { ...operation, cancelRequested: false },
            },
          };
        });
        toast.error(t("sftp.cancelDeleteError"), errorMessage(err));
      });
    },

    transfer: async (fromSide, entries) => {
      const dstSide = otherSide(fromSide);
      const src = get().panes[fromSide];
      const dst = get().panes[dstSide];
      const srcTab = src.tabs.find((t) => t.id === src.activeTabId);
      const dstTab = dst.tabs.find((t) => t.id === dst.activeTabId);
      if (!srcTab || !dstTab) return;

      if (srcTab.status !== "connected" || dstTab.status !== "connected") {
        toast.error(t("sftp.notConnected"));
        return;
      }

      const items =
        entries ??
        srcTab.entries.filter((e) => srcTab.selected.includes(e.path));
      if (items.length === 0) return;

      const occupied = new Set(dstTab.entries.map((entry) => entry.name));
      let batchDecision: ConflictAction | null = null;

      for (const [index, item] of items.entries()) {
        let targetName = item.name;
        let overwrite = false;
        if (occupied.has(targetName)) {
          const decision: ConflictDecision = batchDecision
            ? { action: batchDecision, applyToRemaining: true }
            : await new Promise<ConflictDecision>((resolve) => {
                conflictResolver?.({
                  action: "skip",
                  applyToRemaining: false,
                });
                conflictResolver = resolve;
                set({
                  pendingConflict: {
                    name: item.name,
                    remaining: items.length - index - 1,
                    applyToRemaining: false,
                  },
                });
              });
          if (decision.applyToRemaining) batchDecision = decision.action;
          if (decision.action === "skip") continue;
          if (decision.action === "rename") {
            targetName = uniqueCopyName(item.name, occupied);
          } else {
            overwrite = true;
          }
        }
        occupied.add(targetName);
        const transferId = crypto.randomUUID();
        set((s) => ({
          transfers: {
            ...s.transfers,
            [transferId]: {
              ...pendingTransfer(
                {
                  transferId,
                  transferred: 0,
                  total: item.kind === "file" ? item.size : 0,
                  file: item.name,
                  status: "active",
                  phase: "preparing",
                },
                srcTab.connectionId,
                dstTab.connectionId,
              ),
              destinationSide: dstSide,
              destinationTabId: dstTab.id,
            },
          },
        }));
        try {
          await ipc.sftp.transfer(
            transferId,
            { connectionId: srcTab.connectionId, path: item.path },
            { connectionId: dstTab.connectionId, path: dstTab.cwd },
            targetName,
            overwrite,
          );
          void queryClient.invalidateQueries({ queryKey: transferHistoryKey });
        } catch (err) {
          set((s) => {
            const rest = { ...s.transfers };
            delete rest[transferId];
            return { transfers: rest };
          });
          toast.error(t("sftp.transferError"), errorMessage(err));
        }
      }
    },

    deleteEntries: async (side, tabId, entries) => {
      const tab = get().panes[side].tabs.find(
        (candidate) => candidate.id === tabId,
      );
      if (!tab || entries.length === 0) return;
      if (tab.status !== "connected") {
        toast.error(t("sftp.notConnected"));
        return;
      }

      const operationId = crypto.randomUUID();
      const label =
        entries.length === 1
          ? entries[0].name
          : t("sftp.operation.items", { count: entries.length });
      set((s) => ({
        deletions: {
          ...s.deletions,
          [operationId]: {
            operationId,
            connectionId: tab.connectionId,
            completed: 0,
            total: 0,
            currentPath: entries[0].path,
            status: "active",
            phase: "scanning",
            label,
            side,
            tabId,
            cancelRequested: false,
          },
        },
      }));
      try {
        await ipc.sftp.deleteBatch(
          operationId,
          tab.connectionId,
          entries.map((entry) => ({ path: entry.path })),
        );
      } catch (err) {
        set((s) => {
          const rest = { ...s.deletions };
          delete rest[operationId];
          return { deletions: rest };
        });
        toast.error(t("sftp.deleteError"), errorMessage(err));
      }
    },
  };
});
