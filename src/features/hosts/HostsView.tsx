import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Copy,
  FileInput,
  Folder,
  FolderPlus,
  FolderSync,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useDragCursor } from "@/lib/pointerDrag";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { Group, Host, HostHealthCheck } from "@/types/models";
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
import { terminalPanes, useTabsStore } from "@/workbench/tabs";
import { useSftpStore } from "@/features/sftp/store";
import { useMonitorStore } from "@/features/terminal/monitor";
import {
  useCheckHostHealth,
  useDeleteGroup,
  useDeleteHost,
  useGroups,
  useHosts,
  useMoveGroup,
  useMoveHost,
  useSetHostOsHint,
} from "./api";
import { HostSystemIcon } from "./HostSystemIcon";
import { descendantGroupIds } from "./groupTree";
import { formatSshCommand } from "./ssh-command";

const ConfirmDialog = lazy(() =>
  import("@/components/ui/confirm-dialog").then((module) => ({
    default: module.ConfirmDialog,
  })),
);

const SshConfigImportDialog = lazy(() =>
  import("./SshConfigImportDialog").then((module) => ({
    default: module.SshConfigImportDialog,
  })),
);

const UNGROUPED = "__ungrouped__";
const GROUP_ROOT = "__group_root__";
interface HostDragPointer {
  clientX: number;
  clientY: number;
  rect: DOMRect;
}

interface HostDragState extends HostDragPointer {
  host: Host;
}

interface GroupDragState extends HostDragPointer {
  group: Group;
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
  const moveGroup = useMoveGroup();
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
  const dragGroupRef = useRef<{
    group: Group;
    from: string;
    unavailable: Set<string>;
  } | null>(null);
  const groupDropTargetRef = useRef<string | null>(null);
  const [groupDragState, setGroupDragState] = useState<GroupDragState | null>(
    null,
  );
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const isLoading = hostsLoading || groupsLoading;
  const isError = hostsError || groupsError;

  useDragCursor(dragState !== null || groupDragState !== null);

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
    const element = document.elementFromPoint(clientX, clientY);
    const section = element?.closest<HTMLElement>("[data-host-group-id]");
    const sectionId = section?.dataset.hostGroupId;
    const candidate =
      sectionId ??
      (element?.closest("[data-group-root-drop-target]")
        ? UNGROUPED
        : undefined);
    const nextTarget = candidate && canDropOn(candidate) ? candidate : null;
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

  const beginGroupDrag = (group: Group, pointer: HostDragPointer) => {
    dragGroupRef.current = {
      group,
      from: group.parentId ?? GROUP_ROOT,
      unavailable: descendantGroupIds(groups, group.id),
    };
    setGroupDragState({ group, ...pointer });
  };

  const clearGroupDrag = () => {
    dragGroupRef.current = null;
    groupDropTargetRef.current = null;
    setGroupDragState(null);
    setGroupDropTarget(null);
  };

  const updateGroupDrag = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const section = element?.closest<HTMLElement>("[data-host-group-id]");
    const sectionId = section?.dataset.hostGroupId;
    const candidate = sectionId
      ? sectionId === UNGROUPED
        ? GROUP_ROOT
        : sectionId
      : element?.closest("[data-group-root-drop-target]")
        ? GROUP_ROOT
        : null;
    const drag = dragGroupRef.current;
    const nextTarget =
      drag &&
      candidate &&
      candidate !== drag.from &&
      !drag.unavailable.has(candidate)
        ? candidate
        : null;
    groupDropTargetRef.current = nextTarget;
    setGroupDropTarget(nextTarget);
    setGroupDragState((current) =>
      current ? { ...current, clientX, clientY } : current,
    );
  };

  const endGroupDrag = (didDrag: boolean) => {
    const drag = dragGroupRef.current;
    const target = groupDropTargetRef.current;
    clearGroupDrag();
    if (!didDrag || !drag || !target || target === drag.from) return;
    const parentId = target === GROUP_ROOT ? null : target;
    if (parentId) {
      setCollapsed((current) => ({ ...current, [parentId]: false }));
    }
    moveGroup.mutate(
      { group: drag.group, parentId },
      {
        onError: (error) =>
          toast.error(t("hosts.moveGroup.error"), errorMessage(error)),
      },
    );
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    const groupNames = new Map(
      groups.map((group) => [group.id, group.name.toLowerCase()]),
    );
    return hosts.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        (h.username ?? "").toLowerCase().includes(q) ||
        (h.notes ?? "").toLowerCase().includes(q) ||
        (h.groupId ? groupNames.get(h.groupId)?.includes(q) : false),
    );
  }, [groups, hosts, query]);

  const sections = useMemo(() => {
    const byGroup = new Map<string, Host[]>();
    for (const host of filtered) {
      const key = host.groupId ?? UNGROUPED;
      byGroup.set(key, [...(byGroup.get(key) ?? []), host]);
    }
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const included = new Set<string>();
    if (searching) {
      for (const group of groups) {
        if ((byGroup.get(group.id) ?? []).length === 0) continue;
        let current: typeof group | undefined = group;
        const ancestry = new Set<string>();
        while (current && !ancestry.has(current.id)) {
          ancestry.add(current.id);
          included.add(current.id);
          current = current.parentId
            ? groupById.get(current.parentId)
            : undefined;
        }
      }
    } else {
      for (const group of groups) included.add(group.id);
    }

    const children = new Map<string | null, typeof groups>();
    for (const group of groups) {
      if (!included.has(group.id)) continue;
      const parent =
        group.parentId && groupById.has(group.parentId) ? group.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), group]);
    }

    const ordered: Array<{
      id: string;
      name: string;
      group: Group | null;
      hosts: Host[];
      depth: number;
      ancestors: string[];
    }> = [];
    const visited = new Set<string>();
    const append = (
      parentId: string | null,
      depth: number,
      ancestors: string[],
    ) => {
      for (const group of children.get(parentId) ?? []) {
        if (visited.has(group.id)) continue;
        visited.add(group.id);
        ordered.push({
          id: group.id,
          name: group.name,
          group,
          hosts: byGroup.get(group.id) ?? [],
          depth,
          ancestors,
        });
        append(group.id, depth + 1, [...ancestors, group.id]);
      }
    };
    append(null, 0, []);
    for (const group of groups) {
      if (included.has(group.id) && !visited.has(group.id)) {
        ordered.push({
          id: group.id,
          name: group.name,
          group,
          hosts: byGroup.get(group.id) ?? [],
          depth: 0,
          ancestors: [],
        });
      }
    }
    const ungrouped = byGroup.get(UNGROUPED) ?? [];
    if (ungrouped.length > 0) {
      ordered.push({
        id: UNGROUPED,
        name: t("hosts.ungrouped"),
        group: null,
        hosts: ungrouped,
        depth: 0,
        ancestors: [],
      });
    }
    return ordered;
  }, [filtered, groups, searching, t]);

  const visibleSections = useMemo(
    () =>
      sections.filter(
        (section) =>
          searching || section.ancestors.every((id) => !collapsed[id]),
      ),
    [collapsed, searching, sections],
  );

  const requestDeleteHost = (host: Host) => {
    setConfirmState({
      title: t("hosts.deleteHost.title"),
      description: t("common.deleteConfirm", { name: host.label }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("hosts.deleteHost.action"),
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
    const group = groups.find((candidate) => candidate.id === section.id);
    if (!group) return;
    const childCount = groups.filter(
      (candidate) => candidate.parentId === group.id,
    ).length;
    const parent = group.parentId
      ? groups.find((candidate) => candidate.id === group.parentId)
      : undefined;
    const hostCount = section.hosts.length;
    const relocationDescription = parent
      ? hostCount > 0 && childCount > 0
        ? t("hosts.deleteGroup.nestedBoth", {
            hostCount,
            childCount,
            parent: parent.name,
          })
        : hostCount > 0
          ? t("hosts.deleteGroup.nestedHosts", {
              count: hostCount,
              parent: parent.name,
            })
          : childCount > 0
            ? t("hosts.deleteGroup.nestedGroups", {
                count: childCount,
                parent: parent.name,
              })
            : undefined
      : hostCount > 0 && childCount > 0
        ? t("hosts.deleteGroup.rootBoth", { hostCount, childCount })
        : hostCount > 0
          ? t("hosts.deleteGroup.rootHosts", { count: hostCount })
          : childCount > 0
            ? t("hosts.deleteGroup.rootGroups", { count: childCount })
            : undefined;
    const description = [
      t("common.deleteConfirm", { name: section.name }),
      relocationDescription,
    ]
      .filter(Boolean)
      .join(" ");
    setConfirmState({
      title: t("hosts.deleteGroup.title"),
      description,
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("hosts.deleteGroup.action"),
          variant: "destructive",
          onSelect: () =>
            void deleteGroup.mutateAsync(section.id).catch((error) => {
              toast.error(t("hosts.deleteGroup.error"), errorMessage(error));
            }),
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
      <PanelContent
        data-group-root-drop-target
        className={cn(
          "relative space-y-[var(--panel-gutter)] transition-shadow",
          (groupDropTarget === GROUP_ROOT || dropTarget === UNGROUPED) &&
            "ring-1 ring-inset ring-ring/50",
        )}
      >
        {(groupDropTarget === GROUP_ROOT || dropTarget === UNGROUPED) && (
          <div className="pointer-events-none absolute right-2 top-2 z-10 !m-0 rounded-md bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-sm">
            {groupDropTarget === GROUP_ROOT
              ? t("hosts.moveGroup.toTopLevel")
              : t("hosts.move.toUngrouped")}
          </div>
        )}
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
          visibleSections.map((section) => (
            <GroupSection
              key={section.id}
              id={section.id}
              isGroup={section.id !== UNGROUPED}
              group={section.group}
              name={section.name}
              count={section.hosts.length}
              depth={section.depth}
              collapsed={Boolean(collapsed[section.id]) && !searching}
              onToggle={() =>
                setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))
              }
              onAddHost={() => openHostForm(undefined, section.id)}
              onAddChild={() => openGroupForm(undefined, section.id)}
              onEdit={() => openGroupForm(section.id)}
              onDelete={() => requestDeleteGroup(section)}
              isHostDropTarget={dropTarget === section.id}
              isGroupDropTarget={groupDropTarget === section.id}
              dragging={groupDragState?.group.id === section.id}
              onGroupDragStart={beginGroupDrag}
              onGroupDragMove={updateGroupDrag}
              onGroupDragEnd={endGroupDrag}
            >
              <div className={PANEL_LIST_CLASS}>
                {section.hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    health={healthByHost[host.id]}
                    checking={(checkingHosts[host.id] ?? 0) > 0}
                    dragging={dragState?.host.id === host.id}
                    onDragStart={beginHostDrag}
                    onDragMove={updateHostDrag}
                    onDragEnd={endHostDrag}
                    onCheckHealth={runHealthCheck}
                    onEdit={() => openHostForm(host.id)}
                    onDelete={() => requestDeleteHost(host)}
                  />
                ))}
              </div>
            </GroupSection>
          ))
        )}
      </PanelContent>

      {confirmState && (
        <Suspense fallback={null}>
          <ConfirmDialog
            state={confirmState}
            onClose={() => setConfirmState(null)}
          />
        </Suspense>
      )}
      {importOpen && (
        <Suspense fallback={null}>
          <SshConfigImportDialog open onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
      {dragState && <HostDragGhost dragState={dragState} />}
      {groupDragState && <GroupDragGhost dragState={groupDragState} />}
    </SideBarView>
  );
}

function GroupSection({
  id,
  isGroup,
  group,
  name,
  count,
  depth,
  collapsed,
  isHostDropTarget,
  isGroupDropTarget,
  dragging,
  onToggle,
  onAddHost,
  onAddChild,
  onEdit,
  onDelete,
  onGroupDragStart,
  onGroupDragMove,
  onGroupDragEnd,
  children,
}: {
  id: string;
  isGroup: boolean;
  group: Group | null;
  name: string;
  count: number;
  depth: number;
  collapsed: boolean;
  isHostDropTarget: boolean;
  isGroupDropTarget: boolean;
  dragging: boolean;
  onToggle: () => void;
  onAddHost: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGroupDragStart: (group: Group, pointer: HostDragPointer) => void;
  onGroupDragMove: (clientX: number, clientY: number) => void;
  onGroupDragEnd: (didDrag: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressToggleRef = useRef(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!group || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = dragRef.current;
    if (!group || !pointer || pointer.pointerId !== event.pointerId) return;
    if (!pointer.active) {
      const distance = Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      );
      if (distance < 5) return;
      pointer.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      onGroupDragStart(group, {
        clientX: event.clientX,
        clientY: event.clientY,
        rect: event.currentTarget.getBoundingClientRect(),
      });
    }
    event.preventDefault();
    onGroupDragMove(event.clientX, event.clientY);
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = dragRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const didDrag = event.type !== "pointercancel" && pointer.active;
    if (pointer.active) {
      event.preventDefault();
      suppressToggleRef.current = true;
      window.setTimeout(() => {
        suppressToggleRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onGroupDragEnd(didDrag);
  };

  const header = (
    <PanelSectionHeader
      title={name}
      collapsed={collapsed}
      onToggle={() => {
        if (!suppressToggleRef.current) onToggle();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      className={cn(isGroup && "touch-none select-none cursor-grab")}
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
      style={
        depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 12}px` } : undefined
      }
      className={cn(
        "rounded-lg transition-[background-color,box-shadow]",
        (isHostDropTarget || isGroupDropTarget) &&
          "bg-list-hover ring-1 ring-inset ring-ring/50",
        dragging && "opacity-50",
      )}
    >
      {isGroup ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={onAddHost}>
              <Plus /> {t("hosts.newHost")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={onAddChild}>
              <FolderPlus /> {t("hosts.newGroup")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onEdit}>
              <Pencil /> {t("common.edit")}
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
  onDragStart: (host: Host, pointer: HostDragPointer) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (didDrag: boolean) => void;
  onCheckHealth: (hostIds: string[]) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const tabs = useTabsStore((s) => s.tabs);
  const hostSessions = terminalPanes(tabs).filter((x) => x.hostId === host.id);
  const connected = hostSessions.some((x) => x.status === "connected");
  const detectedOs = useMonitorStore((s) =>
    hostSessions
      .map((session) => {
        const entry = s.bySession[session.id];
        return entry?.attempt === session.attempt ? entry.stats?.os : undefined;
      })
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

  const copySshCommand = async () => {
    try {
      await navigator.clipboard.writeText(formatSshCommand(host));
      toast.success(t("common.copied"));
    } catch (err) {
      toast.error(t("hosts.copySshCommandError"), errorMessage(err));
    }
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
      onDragStart(host, {
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
                  "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface group-hover:ring-list-hover group-focus-within:ring-list-hover",
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
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                {host.label}
              </p>
            </div>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {host.username ? `${host.username}@` : ""}
              {host.address}
            </p>
          </div>
          <div className="pointer-events-none -ml-2 flex w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-[3.125rem] group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:ml-0 group-focus-within:w-[3.125rem] group-focus-within:opacity-100">
            <Tooltip content={t("hosts.health.check")}>
              <button
                type="button"
                disabled={checking}
                onClick={(event) => {
                  event.stopPropagation();
                  onCheckHealth([host.id]);
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
        <ContextMenuItem onSelect={() => onCheckHealth([host.id])}>
          <RefreshCw /> {t("hosts.health.check")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copySshCommand()}>
          <Copy /> {t("hosts.copySshCommand")}
        </ContextMenuItem>
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
      className="pointer-events-none fixed z-[1001] flex items-center gap-2 rounded-lg border border-border bg-popover px-2 py-1.5 text-sm text-popover-foreground opacity-95 shadow-md"
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

function GroupDragGhost({ dragState }: { dragState: GroupDragState }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] flex items-center gap-2 rounded-lg border border-border bg-popover px-2 py-1.5 text-sm text-popover-foreground opacity-95 shadow-md"
      style={{
        left: dragState.clientX,
        top: dragState.clientY,
        width: dragState.rect.width,
        height: dragState.rect.height,
      }}
    >
      <Folder className="size-4 shrink-0 text-link" />
      <p className="truncate">{dragState.group.name}</p>
    </div>
  );
}
