import { layoutPaneIds, type PaneLayout } from "./pane-layout";
import type { TerminalTab, TerminalTarget } from "./tabs";

export const WORKSPACE_STORAGE_KEY = "sageport.workspace.v1";
const MAX_WORKSPACE_BYTES = 256 * 1024;
const MAX_LAYOUT_DEPTH = 20;

interface WorkspaceSnapshot {
  version: 1;
  activeId: string | null;
  lastPaneId: string | null;
  tabs: TerminalTab[];
}

function isTarget(value: unknown): value is TerminalTarget {
  return value === "ssh" || value === "local" || value === "ssh-adhoc";
}

function isLayout(value: unknown, depth = 0): value is PaneLayout {
  if (depth > MAX_LAYOUT_DEPTH) return false;
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "leaf") return typeof node.paneId === "string";
  if (node.type !== "split") return false;
  return (
    typeof node.id === "string" &&
    (node.direction === "row" || node.direction === "column") &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    node.children.length <= 10 &&
    node.children.every((child) => isLayout(child, depth + 1)) &&
    Array.isArray(node.sizes) &&
    node.sizes.length === node.children.length &&
    node.sizes.every((size) => typeof size === "number" && size > 0)
  );
}

function restoreAdhoc(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const target = value as Record<string, unknown>;
  if (
    typeof target.host !== "string" ||
    !target.host.trim() ||
    target.host.length > 255 ||
    typeof target.username !== "string" ||
    !target.username.trim() ||
    target.username.length > 255 ||
    typeof target.port !== "number" ||
    !Number.isInteger(target.port) ||
    target.port < 1 ||
    target.port > 65535
  ) {
    return null;
  }
  return {
    host: target.host,
    username: target.username,
    port: target.port,
  };
}

function restoreTab(value: unknown): TerminalTab | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as TerminalTab;
  if (
    tab.kind !== "terminal" ||
    typeof tab.id !== "string" ||
    !Array.isArray(tab.panes) ||
    tab.panes.length === 0 ||
    tab.panes.length > 10 ||
    !isLayout(tab.layout)
  ) {
    return null;
  }
  const panes = tab.panes.filter((pane) => {
    if (
      !pane ||
      typeof pane.id !== "string" ||
      pane.id.length > 128 ||
      !isTarget(pane.target) ||
      typeof pane.hostId !== "string" ||
      pane.hostId.length > 128 ||
      typeof pane.title !== "string" ||
      pane.title.length > 1024
    ) {
      return false;
    }
    return pane.target !== "ssh-adhoc" || restoreAdhoc(pane.adhoc) !== null;
  });
  const ids = layoutPaneIds(tab.layout);
  const paneIds = new Set(panes.map((pane) => pane.id));
  if (
    panes.length !== tab.panes.length ||
    paneIds.size !== panes.length ||
    ids.length !== panes.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !paneIds.has(id))
  ) {
    return null;
  }
  const activePaneId = panes.some((pane) => pane.id === tab.activePaneId)
    ? tab.activePaneId
    : panes[0]!.id;
  return {
    kind: "terminal",
    id: tab.id,
    panes: panes.map((pane) => ({
      id: pane.id,
      target: pane.target,
      hostId: pane.hostId,
      adhoc:
        pane.target === "ssh-adhoc" ? restoreAdhoc(pane.adhoc)! : undefined,
      title: pane.title,
      status: "closed",
      attempt: 0,
      restorePending: true,
    })),
    layout: tab.layout,
    activePaneId,
  };
}

export function readWorkspace(storage: Pick<Storage, "getItem">): {
  tabs: TerminalTab[];
  activeId: string | null;
  lastPaneId: string | null;
} {
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY) ?? "null";
    if (raw.length > MAX_WORKSPACE_BYTES) {
      return { tabs: [], activeId: null, lastPaneId: null };
    }
    const parsed = JSON.parse(raw) as WorkspaceSnapshot | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs)) {
      return { tabs: [], activeId: null, lastPaneId: null };
    }
    const tabs = parsed.tabs
      .map(restoreTab)
      .filter((tab): tab is TerminalTab => Boolean(tab));
    const activeId = tabs.some((tab) => tab.id === parsed.activeId)
      ? parsed.activeId
      : (tabs[0]?.id ?? null);
    const panes = tabs.flatMap((tab) => tab.panes);
    const lastPaneId = panes.some((pane) => pane.id === parsed.lastPaneId)
      ? parsed.lastPaneId
      : (tabs.find((tab) => tab.id === activeId)?.activePaneId ?? null);
    return { tabs, activeId, lastPaneId };
  } catch {
    return { tabs: [], activeId: null, lastPaneId: null };
  }
}

export function writeWorkspace(
  storage: Pick<Storage, "setItem">,
  state: {
    tabs: readonly { kind: string }[];
    activeId: string | null;
    lastPaneId: string | null;
  },
) {
  const tabs = state.tabs
    .filter((tab): tab is TerminalTab => tab.kind === "terminal")
    .map((tab) => ({
      ...tab,
      panes: tab.panes.map(
        ({
          status: _status,
          error: _error,
          errorCode: _errorCode,
          attempt: _attempt,
          restorePending: _restorePending,
          ...pane
        }) => ({ ...pane, status: "closed" as const, attempt: 0 }),
      ),
    }));
  const snapshot: WorkspaceSnapshot = {
    version: 1,
    tabs,
    activeId: tabs.some((tab) => tab.id === state.activeId)
      ? state.activeId
      : null,
    lastPaneId: state.lastPaneId,
  };
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
}
