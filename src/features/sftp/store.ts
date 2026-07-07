import { create } from "zustand";

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

function t(key: Parameters<typeof translate>[1]): string {
  return translate(detectLocale(), key);
}

function describeConnectError(code?: string | null, message?: string) {
  if (code === "invalid") return t("sftp.credentialsMissing");
  if (code === "auth") return t("sftp.authFailed");
  return message;
}

export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

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
  status: TabStatus;
  entries: FileEntry[];
  selected: string[];
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

  transfers: Record<string, TransferEvent>;

  showHidden: boolean;

  setRatio: (r: number) => void;
  toggleHidden: () => void;

  addLocalTab: (side: PaneSide) => Promise<void>;
  addRemoteTab: (side: PaneSide, host: Host) => void;
  closeTab: (side: PaneSide, tabId: string) => void;
  setActive: (side: PaneSide, tabId: string) => void;

  navigate: (side: PaneSide, tabId: string, path: string) => Promise<void>;
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

  transfer: (
    fromSide: PaneSide,
    entries?: FileEntry[],
    opts?: { compress?: boolean },
  ) => Promise<void>;
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

  const loadEntries = async (side: PaneSide, tabId: string, path: string) => {
    const pane = get().panes[side];
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (
      tab.kind === "remote" &&
      (!path || tab.status === "closed" || tab.status === "error")
    ) {
      return;
    }
    patchTab(side, tabId, { loading: true, error: undefined });
    try {
      const entries = await ipc.sftp.list(tab.connectionId, path);
      patchTab(side, tabId, {
        cwd: path,
        entries,
        selected: [],
        loading: false,
      });
    } catch (err) {
      patchTab(side, tabId, { loading: false, error: errorMessage(err) });
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

    closeTab: (side, tabId) => {
      const pane = get().panes[side];
      const tab = pane.tabs.find((t) => t.id === tabId);
      if (tab?.kind === "remote" && tab.connectionId) {
        void ipc.sftp.disconnect(tab.connectionId).catch(() => {});
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

    setActive: (side, tabId) =>
      set((s) => ({
        panes: { ...s.panes, [side]: { ...s.panes[side], activeTabId: tabId } },
      })),

    navigate: (side, tabId, path) => loadEntries(side, tabId, path),

    refresh: (side, tabId) => {
      const tab = get().panes[side].tabs.find((t) => t.id === tabId);
      if (tab?.kind === "remote" && (tab.status !== "connected" || !tab.cwd)) {
        return Promise.resolve();
      }
      return tab ? loadEntries(side, tabId, tab.cwd) : Promise.resolve();
    },

    setSelected: (side, tabId, selected) => patchTab(side, tabId, { selected }),

    applyStatus: (connectionId, status, message, code) => {
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
        set((s) => ({ transfers: { ...s.transfers, [e.transferId]: e } }));
        return;
      }

      set((s) => {
        const rest = { ...s.transfers };
        delete rest[e.transferId];
        return { transfers: rest };
      });
      if (e.status === "error") {
        toast.error(t("sftp.transferFailed"), e.message);
      }

      void get().refresh("left", get().panes.left.activeTabId ?? "");
      void get().refresh("right", get().panes.right.activeTabId ?? "");
    },

    cancelTransfer: (transferId) => {
      void ipc.sftp.cancelTransfer(transferId).catch(() => {});
    },

    transfer: async (fromSide, entries, opts) => {
      const dstSide = otherSide(fromSide);
      const src = get().panes[fromSide];
      const dst = get().panes[dstSide];
      const srcTab = src.tabs.find((t) => t.id === src.activeTabId);
      const dstTab = dst.tabs.find((t) => t.id === dst.activeTabId);
      if (!srcTab || !dstTab) return;

      const items =
        entries ??
        srcTab.entries.filter((e) => srcTab.selected.includes(e.path));
      if (items.length === 0) return;

      const compress = opts?.compress ?? false;
      for (const item of items) {
        const transferId = crypto.randomUUID();
        await ipc.sftp
          .transfer(
            transferId,
            { connectionId: srcTab.connectionId, path: item.path },
            { connectionId: dstTab.connectionId, path: dstTab.cwd },
            compress,
          )
          .catch((err) => {
            toast.error(t("sftp.transferError"), errorMessage(err));
          });
      }
    },
  };
});
