import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
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
  Input,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { Host, HostHealthCheck } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { useOverlayStore } from "@/workbench/overlays";
import { SideBarView } from "@/workbench/SideBarView";
import { terminalTabs, useTabsStore } from "@/workbench/tabs";
import { useSftpStore } from "@/features/sftp/store";
import {
  useCheckHostHealth,
  useDeleteGroup,
  useDeleteHost,
  useGroups,
  useHosts,
} from "./api";
import { SshConfigImportDialog } from "./SshConfigImportDialog";

const UNGROUPED = "__ungrouped__";
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
  const { data: hosts = [], isLoading } = useHosts();
  const { data: groups = [] } = useGroups();
  const deleteHost = useDeleteHost();
  const deleteGroup = useDeleteGroup();
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

  const searching = query.trim().length > 0;

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
              className="size-6"
              onClick={() => openHostForm()}
            >
              <Plus className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.newGroup")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => openGroupForm()}
            >
              <FolderPlus className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.import.action")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => setImportOpen(true)}
            >
              <FileInput className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("hosts.health.checkAll")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
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
    >
      <div className="px-2 pb-1">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hosts.filterPlaceholder")}
          className="h-6.5 bg-background text-xs"
        />
      </div>

      <div className="px-1 pb-4">
        {isLoading ? null : sections.length === 0 ? (
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
          />
        ) : (
          sections.map((section) => (
            <GroupSection
              key={section.id}
              isGroup={section.id !== UNGROUPED}
              name={section.name}
              count={section.hosts.length}
              collapsed={Boolean(collapsed[section.id]) && !searching}
              onToggle={() =>
                setCollapsed((c) => ({ ...c, [section.id]: !c[section.id] }))
              }
              onEdit={() => openGroupForm(section.id)}
              onDelete={() => requestDeleteGroup(section)}
            >
              {section.hosts.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  health={healthByHost[host.id]}
                  checking={(checkingHosts[host.id] ?? 0) > 0}
                  onCheckHealth={() => runHealthCheck([host.id])}
                  onEdit={() => openHostForm(host.id)}
                  onDelete={() => requestDeleteHost(host)}
                />
              ))}
            </GroupSection>
          ))
        )}
      </div>

      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
      <SshConfigImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
    </SideBarView>
  );
}

function GroupSection({
  isGroup,
  name,
  count,
  collapsed,
  onToggle,
  onEdit,
  onDelete,
  children,
}: {
  isGroup: boolean;
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  const header = (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-list-hover hover:text-foreground"
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 shrink-0" />
      ) : (
        <ChevronDown className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{name}</span>
      <span className="ml-auto pr-1 font-normal tabular-nums">{count}</span>
    </button>
  );

  return (
    <div className="mb-0.5">
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
  onCheckHealth,
  onEdit,
  onDelete,
}: {
  host: Host;
  health?: HostHealthCheck;
  checking: boolean;
  onCheckHealth: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const connected = useTabsStore((s) =>
    terminalTabs(s.tabs).some(
      (x) => x.hostId === host.id && x.status === "connected",
    ),
  );
  const addRemoteTab = useSftpStore((s) => s.addRemoteTab);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);

  const openSftp = () => {
    setPanelVisible(true);
    addRemoteTab("right", host);
  };

  const healthTooltip = connected
    ? t("hosts.health.connected")
    : health
      ? health.status === "online"
        ? t("hosts.health.online", { ms: health.latencyMs ?? 0 })
        : t("hosts.health.offline", {
            reason: t(
              HEALTH_REASON_KEYS[health.errorKind ?? "unknown"] ??
                "hosts.health.reason.unknown",
            ),
          })
      : t("hosts.health.unknown");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onDoubleClick={() => openTerminal(host)}
          className="group flex cursor-pointer items-center gap-2 rounded-md py-1 pl-6 pr-2 hover:bg-list-hover"
        >
          <Tooltip content={healthTooltip}>
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                connected || health?.status === "online"
                  ? "bg-success"
                  : health?.status === "offline"
                    ? "bg-destructive"
                    : "bg-muted-foreground/40",
              )}
            />
          </Tooltip>
          <span className="truncate text-sm">{host.label}</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {host.username ? `${host.username}@` : ""}
            {host.address}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content={t("hosts.health.check")}>
              <button
                disabled={checking}
                onClick={(event) => {
                  event.stopPropagation();
                  onCheckHealth();
                }}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground disabled:opacity-40 group-hover:opacity-100"
              >
                <RefreshCw
                  className={cn("size-3.5", checking && "animate-spin")}
                />
              </button>
            </Tooltip>
            <Tooltip content={t("hosts.connect")}>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  openTerminal(host);
                }}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
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
