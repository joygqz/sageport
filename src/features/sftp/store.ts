import { create } from "zustand";

import { useHostKeyStore } from "@/features/terminal/host-key";
import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type {
  FileEntry,
  Host,
  SftpStatusKind,
  TransferEvent,
} from "@/types/models";
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

interface PaneState {
  tabs: SftpTab[];
  activeTabId: string | null;
}

interface SftpState {
  ratio: number;
  panes: Record<PaneSide, PaneState>;

  transfers: Record<string, ActiveTransfer>;

  showHidden: boolean;

  setRatio: (r: number) => void;
  toggleHidden: () => void;

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

  cancelTransfer: (transferId: string) => void;

  transfer: (fromSide: PaneSide, entries?: FileEntry[]) => Promise<void>;
}

const otherSide = (side: PaneSide): PaneSide =>
  side === "left" ? "right" : "left";

export function parentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return trimmed.startsWith("/") ? "/" : trimmed || "/";
  return trimmed.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

const emptyPane = (): PaneState => ({ tabs: [], activeTabId: null });

let eventsBridged = false;
export function bridgeSftpEvents(): void {
  if (eventsBridged) return;
  eventsBridged = true;
  const { applyStatus, applyTransfer } = useSftpStore.getState();
  void ipc.sftp.onStatus((e) =>
    applyStatus(e.connectionId, e.status, e.message, e.code),
  );
  void ipc.sftp.onTransfer((e) => applyTransfer(e));
}

export const useSftpStore = create<SftpState>((set, get) => {
  const canAddTab = () => {
    const { left, right } = get().panes;
    if (left.tabs.length + right.tabs.length < MAX_SFTP_TABS) return true;
    toast.warning(t("sftp.tabLimitReached", { count: MAX_SFTP_TABS }));
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
    patchTab(side, tabId, {
      loading: true,
      error: undefined,
      navigationPath: path,
    });
    try {
      const entries = await ipc.sftp.list(tab.connectionId, path);
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
    showHidden: false,

    setRatio: (r) => set({ ratio: Math.max(0, Math.min(r, 1)) }),

    toggleHidden: () => set((s) => ({ showHidden: !s.showHidden })),

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

    restoreLoadedPath: (side, tabId) =>
      patchTab(side, tabId, {
        navigationPath: undefined,
        error: undefined,
      }),

    refresh: (side, tabId) => {
      const tab = get().panes[side].tabs.find((t) => t.id === tabId);
      if (tab?.kind === "remote" && (tab.status !== "connected" || !tab.cwd)) {
        return Promise.resolve();
      }
      return tab ? loadEntries(side, tabId, tab.cwd, null) : Promise.resolve();
    },

    setSelected: (side, tabId, selected) => patchTab(side, tabId, { selected }),

    applyStatus: (connectionId, status, message, code) => {
      if (status === "error" || status === "closed")
        useHostKeyStore.getState().rejectSession(connectionId);
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

      for (const item of items) {
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
        await ipc.sftp
          .transfer(
            transferId,
            { connectionId: srcTab.connectionId, path: item.path },
            { connectionId: dstTab.connectionId, path: dstTab.cwd },
          )
          .catch((err) => {
            set((s) => {
              const rest = { ...s.transfers };
              delete rest[transferId];
              return { transfers: rest };
            });
            toast.error(t("sftp.transferError"), errorMessage(err));
          });
      }
    },
  };
});
