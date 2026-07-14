import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FileInput,
  FolderPlus,
  FolderSync,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, HostHealthCheck } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { useOverlayStore } from "@/workbench/overlays";
import {
  PanelContent,
  PANEL_HEADER_ACTION_CLASS,
  PANEL_LIST_ACTION_CLASS,
  PANEL_LIST_CLASS,
  PANEL_LIST_ITEM_CLASS,
  PanelSectionHeader,
} from "@/workbench/PanelHeader";
import { SideBarView } from "@/workbench/SideBarView";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import { terminalTabs, useTabsStore } from "@/workbench/tabs";
import { useSftpStore } from "@/features/sftp/store";
import { useMonitorStore } from "@/features/terminal/monitor";
import {
  useCheckHostHealth,
  useDeleteGroup,
  useDeleteHost,
  useGroups,
  useHosts,
  useMoveHost,
  useSetHostOsHint,
} from "./api";
import { HostSystemIcon } from "./HostSystemIcon";
import { SshConfigImportDialog } from "./SshConfigImportDialog";

const UNGROUPED = "__ungrouped__";
interface HostDragPointer {
  clientX: number;
  clientY: number;
  rect: DOMRect;
}

interface HostDragState extends HostDragPointer {
  host: Host;
}

const HEALTH_REASON_KEYS = {
  timeout: "hosts.health.reason.timeout",
  refused: "hosts.health.reason.refused",
  dns: "hosts.health.reason.dns",
  invalidPort: "hosts.health.reason.invalidPort",
  network: "hosts.health.reason.network",
  unknown: "hosts.health.reason.unknown",
} as const;

export function HostsView() {
  const { t } = useI18n();
  const {
    data: hosts = [],
    isLoading: hostsLoading,
    isError: hostsError,
    refetch: refetchHosts,
  } = useHosts();
  const {
    data: groups = [],
    isLoading: groupsLoading,
    isError: groupsError,
    refetch: refetchGroups,
  } = useGroups();
  const deleteHost = useDeleteHost();
  const deleteGroup = useDeleteGroup();
  const moveHost = useMoveHost();
  const checkHealth = useCheckHostHealth();
  const openHostForm = useOverlayStore((s) => s.openHostForm);
  const openGroupForm = useOverlayStore((s) => s.openGroupForm);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [healthByHost, setHealthByHost] = useState<
    Record<string, HostHealthCheck>
  >({});
  const [checkingHosts, setCheckingHosts] = useState<Record<string, number>>(
    {},
  );
  const healthRequestSeq = useRef(0);
  const latestHealthRequest = useRef<Record<string, number>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const dragHostRef = useRef<{ id: string; from: string } | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const [dragState, setDragState] = useState<HostDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const isLoading = hostsLoading || groupsLoading;
  const isError = hostsError || groupsError;

  useEffect(() => {
    if (!dragState) return;

    const style = document.createElement("style");
    style.textContent = "* { cursor: default !important; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [dragState]);

  const beginHostDrag = (host: Host, pointer: HostDragPointer) => {
    dragHostRef.current = { id: host.id, from: host.groupId ?? UNGROUPED };
    setDragState({ host, ...pointer });
  };
  const clearHostDrag = () => {
    dragHostRef.current = null;
    dropTargetRef.current = null;
    setDragState(null);
    setDropTarget(null);
  };

  const canDropOn = (sectionId: string) => {
    const drag = dragHostRef.current;
    return drag != null && drag.from !== sectionId;
  };

  const updateHostDrag = (clientX: number, clientY: number) => {
    const section = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-host-group-id]");
    const sectionId = section?.dataset.hostGroupId;
    const nextTarget = sectionId && canDropOn(sectionId) ? sectionId : null;
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
    setDragState((current) =>
      current ? { ...current, clientX, clientY } : current,
    );
  };

  const endHostDrag = (didDrag: boolean) => {
    const drag = dragHostRef.current;
    const sectionId = dropTargetRef.current;
    clearHostDrag();
    if (!didDrag || !drag || !sectionId || drag.from === sectionId) return;
    moveHost.mutate(
      { id: drag.id, groupId: sectionId === UNGROUPED ? null : sectionId },
      {
        onError: (err) => toast.error(t("hosts.move.error"), errorMessage(err)),
      },
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        (h.username ?? "").toLowerCase().includes(q),
    );
  }, [hosts, query]);

  const sections = useMemo(() => {
    const byGroup = new Map<string, Host[]>();
    for (const host of filtered) {
      const key = host.groupId ?? UNGROUPED;
      byGroup.set(key, [...(byGroup.get(key) ?? []), host]);
    }
    const ordered = groups
      .map((g) => ({ id: g.id, name: g.name, hosts: byGroup.get(g.id) ?? [] }))
      .filter((s) => !searching || s.hosts.length > 0);
    const ungrouped = byGroup.get(UNGROUPED) ?? [];
    if (ungrouped.length > 0) {
      ordered.push({
        id: UNGROUPED,
        name: t("hosts.ungrouped"),
        hosts: ungrouped,
      });
    }
    return ordered;
  }, [filtered, groups, searching, t]);

  const requestDeleteHost = (host: Host) => {
    setConfirmState({
      title: t("hosts.deleteHost.title"),
      description: t("common.deleteConfirm", { name: host.label }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () =>
            void deleteHost.mutateAsync(host.id).catch((err) => {
              toast.error(t("hosts.deleteHost.error"), errorMessage(err));
            }),
        },
      ],
    });
  };

  const requestDeleteGroup = (section: {
    id: string;
    name: string;
    hosts: Host[];
  }) => {
    const doDelete = (deleteHosts: boolean) =>
      void deleteGroup
        .mutateAsync({ id: section.id, deleteHosts })
        .catch((err) => {
          toast.error(t("hosts.deleteGroup.error"), errorMessage(err));
        });

    const hasHosts = section.hosts.length > 0;
    setConfirmState({
      title: t("hosts.deleteGroup.title"),
      description: hasHosts
        ? t("hosts.deleteGroup.withHostsDescription", {
            name: section.name,
            count: section.hosts.length,
          })
        : t("common.deleteConfirm", { name: section.name }),
      cancelLabel: t("common.cancel"),
      actions: hasHosts
        ? [
            {
              label: t("hosts.deleteGroup.keepHosts"),
              variant: "outline",
              onSelect: () => doDelete(false),
            },
            {
              label: t("hosts.deleteGroup.withHosts"),
              variant: "destructive",
              onSelect: () => doDelete(true),
            },
          ]
        : [
            {
              label: t("common.delete"),
              variant: "destructive",
              onSelect: () => doDelete(false),
            },
          ],
    });
  };

  const runHealthCheck = (hostIds?: string[]) => {
    const all = hostIds == null;
    const ids = hostIds ?? hosts.map((host) => host.id);
    if (ids.length === 0) return;
    const requestId = ++healthRequestSeq.current;
    for (const id of ids) latestHealthRequest.current[id] = requestId;

    setHealthByHost((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    if (all) setCheckingAll(true);
    setCheckingHosts((current) => {
      const next = { ...current };
      for (const id of ids) next[id] = requestId;
      return next;
    });

    const finishHost = (result: HostHealthCheck) => {
      if (latestHealthRequest.current[result.hostId] !== requestId) return;
      delete latestHealthRequest.current[result.hostId];
      setHealthByHost((current) => ({
        ...current,
        [result.hostId]: result,
      }));
      setCheckingHosts((current) => {
        if (current[result.hostId] !== requestId) return current;
        const next = { ...current };
        delete next[result.hostId];
        return next;
      });
    };

    void checkHealth
      .mutateAsync({ hostIds, onResult: finishHost })
      .then((results) => {
        for (const result of results) finishHost(result);
      })
      .catch((err) => {
        toast.error(t("hosts.health.error"), errorMessage(err));
      })
      .finally(() => {
        if (all) setCheckingAll(false);
        setCheckingHosts((current) => {
          const next = { ...current };
          for (const id of ids) {
            if (latestHealthRequest.current[id] === requestId) {
              delete latestHealthRequest.current[id];
            }
            if (next[id] === requestId) delete next[id];
          }
          return next;
        });
      });
  };

  return (
    <SideBarView
      title={t("hosts.viewTitle")}
      actions={
        <>
          <Tooltip content={t("hosts.newHost")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => openHostForm()}
            >
              <Plus className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.newGroup")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => openGroupForm()}
            >
              <FolderPlus className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.import.action")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => setImportOpen(true)}
            >
              <FileInput className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.health.checkAll")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              disabled={hosts.length === 0 || checkingAll}
              onClick={() => runHealthCheck()}
            >
              <RefreshCw
                className={cn("size-4", checkingAll && "animate-spin")}
              />
            </Button>
          </Tooltip>
        </>
      }
      topContent={
        <SideBarFilter
          itemCount={hosts.length}
          value={query}
          onChange={setQuery}
          placeholder={t("hosts.filterPlaceholder")}
        />
      }
    >
      <PanelContent className="space-y-[var(--panel-gutter)]">
        {isLoading ? (
          <LoadingState label={t("common.loading")} fill />
        ) : isError ? (
          <ErrorState
            title={t("common.loadError")}
            retryLabel={t("common.retry")}
            onRetry={() => {
              void Promise.all([refetchHosts(), refetchGroups()]);
            }}
            fill
          />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={Server}
            title={searching ? t("hosts.noMatches") : t("hosts.empty.title")}
            description={searching ? undefined : t("hosts.empty.description")}
            action={
              !searching && (
                <Button size="sm" onClick={() => openHostForm()}>
                  <Plus /> {t("hosts.newHost")}
                </Button>
              )
            }
            fill={!searching}
          />
        ) : (
          sections.map((section) => (
            <GroupSection
              key={section.id}
              id={section.id}
              isGroup={section.id !== UNGROUPED}
              name={section.name}
              count={section.hosts.length}
              collapsed={Boolean(collapsed[section.id]) && !searching}
              onToggle={() =>
                setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))
              }
              onEdit={() => openGroupForm(section.id)}
              onDelete={() => requestDeleteGroup(section)}
              isDropTarget={dropTarget === section.id}
            >
              <div className={PANEL_LIST_CLASS}>
                {section.hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    health={healthByHost[host.id]}
                    checking={(checkingHosts[host.id] ?? 0) > 0}
                    dragging={dragState?.host.id === host.id}
                    onDragStart={(pointer) => beginHostDrag(host, pointer)}
                    onDragMove={updateHostDrag}
                    onDragEnd={endHostDrag}
                    onCheckHealth={() => runHealthCheck([host.id])}
                    onEdit={() => openHostForm(host.id)}
                    onDelete={() => requestDeleteHost(host)}
                  />
                ))}
              </div>
            </GroupSection>
          ))
        )}
      </PanelContent>

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
      <SshConfigImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
      {dragState && <HostDragGhost dragState={dragState} />}
    </SideBarView>
  );
}

function GroupSection({
  id,
  isGroup,
  name,
  count,
  collapsed,
  isDropTarget,
  onToggle,
  onEdit,
  onDelete,
  children,
}: {
  id: string;
  isGroup: boolean;
  name: string;
  count: number;
  collapsed: boolean;
  isDropTarget: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  const header = (
    <PanelSectionHeader
      title={name}
      collapsed={collapsed}
      onToggle={onToggle}
      trailing={
        <span className="min-w-6 rounded-full bg-muted px-1.5 py-0.5 text-center text-2xs font-normal tabular-nums text-muted-foreground">
          {count}
        </span>
      }
    />
  );

  return (
    <div
      data-host-group-id={id}
      className={cn(
        "rounded-lg transition-[background-color,box-shadow]",
        isDropTarget && "bg-list-hover ring-1 ring-inset ring-ring/50",
      )}
    >
      {isGroup ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={onEdit}>
              <Pencil /> {t("common.rename")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem destructive onSelect={onDelete}>
              <Trash2 /> {t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        header
      )}
      {!collapsed && children}
    </div>
  );
}

function HostRow({
  host,
  health,
  checking,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onCheckHealth,
  onEdit,
  onDelete,
}: {
  host: Host;
  health?: HostHealthCheck;
  checking: boolean;
  dragging: boolean;
  onDragStart: (pointer: HostDragPointer) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (didDrag: boolean) => void;
  onCheckHealth: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const tabs = useTabsStore((s) => s.tabs);
  const hostSessions = terminalTabs(tabs).filter((x) => x.hostId === host.id);
  const connected = hostSessions.some((x) => x.status === "connected");
  const detectedOs = useMonitorStore((s) =>
    hostSessions
      .map((session) => s.bySession[session.id]?.stats?.os)
      .find((os): os is string => Boolean(os)),
  );
  const { mutate: setHostOsHint, isPending: settingHostOsHint } =
    useSetHostOsHint();
  const addRemoteTab = useSftpStore((s) => s.addRemoteTab);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  useEffect(() => {
    if (!detectedOs || detectedOs === host.osHint || settingHostOsHint) {
      return;
    }
    setHostOsHint({ id: host.id, osHint: detectedOs });
  }, [detectedOs, host.id, host.osHint, setHostOsHint, settingHostOsHint]);

  const openSftp = () => {
    setPanelVisible(true);
    addRemoteTab("right", host);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(
        e.clientX - drag.startX,
        e.clientY - drag.startY,
      );
      if (distance < 5) return;
      drag.active = true;
      onDragStart({
        clientX: e.clientX,
        clientY: e.clientY,
        rect: e.currentTarget.getBoundingClientRect(),
      });
    }

    e.preventDefault();
    onDragMove(e.clientX, e.clientY);
  };

  const finishPointerDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) e.preventDefault();
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onDragEnd(e.type !== "pointercancel" && drag.active);
  };

  const healthTooltip = health
    ? health.status === "online"
      ? t("hosts.health.online", { ms: health.latencyMs ?? 0 })
      : t("hosts.health.offline", {
          reason: t(
            HEALTH_REASON_KEYS[health.errorKind ?? "unknown"] ??
              "hosts.health.reason.unknown",
          ),
        })
    : connected
      ? t("hosts.health.connected")
      : t("hosts.health.unknown");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            openTerminal(host);
          }}
          className={cn(
            PANEL_LIST_ITEM_CLASS,
            "cursor-pointer touch-none select-none outline-none",
            dragging && "opacity-50",
          )}
        >
          <Tooltip content={healthTooltip}>
            <div className="relative shrink-0">
              <HostSystemIcon os={detectedOs ?? host.osHint} />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-[8px] rounded-full ring-2 ring-surface",
                  connected || health?.status === "online"
                    ? "bg-success"
                    : health?.status === "offline"
                      ? "bg-destructive"
                      : "bg-muted-foreground/55",
                )}
              />
            </div>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {host.label}
            </p>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {host.username ? `${host.username}@` : ""}
              {host.address}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content={t("hosts.health.check")}>
              <button
                type="button"
                disabled={checking}
                onClick={(event) => {
                  event.stopPropagation();
                  onCheckHealth();
                }}
                className={cn(PANEL_LIST_ACTION_CLASS, "disabled:opacity-40")}
              >
                <RefreshCw
                  className={cn("size-3.5", checking && "animate-spin")}
                />
              </button>
            </Tooltip>
            <Tooltip content={t("hosts.connect")}>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openTerminal(host);
                }}
                className={PANEL_LIST_ACTION_CLASS}
              >
                <Plug className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openTerminal(host)}>
          <Plug /> {t("hosts.connect")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={openSftp}>
          <FolderSync /> {t("hosts.openSftp")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCheckHealth}>
          <RefreshCw /> {t("hosts.health.check")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEdit}>
          <Pencil /> {t("common.edit")}
        </ContextMenuItem>
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 /> {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HostDragGhost({ dragState }: { dragState: HostDragState }) {
  const { host } = dragState;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[100] flex items-center gap-2 rounded-lg border border-border bg-popover px-2 py-1.5 text-sm text-popover-foreground opacity-95 shadow-md"
      style={{
        left: dragState.clientX,
        top: dragState.clientY,
        width: dragState.rect.width,
        height: dragState.rect.height,
      }}
    >
      <HostSystemIcon os={host.osHint} />
      <div className="min-w-0 flex-1">
        <p className="truncate">{host.label}</p>
        <p className="truncate font-mono text-2xs text-muted-foreground">
          {host.username ? `${host.username}@` : ""}
          {host.address}
        </p>
      </div>
    </div>
  );
}
