import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderSync,
  Pencil,
  Plug,
  Plus,
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
import type { Host } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { useOverlayStore } from "@/workbench/overlays";
import { SideBarView } from "@/workbench/SideBarView";
import { terminalTabs, useTabsStore } from "@/workbench/tabs";
import { useSftpStore } from "@/features/sftp/store";
import { useDeleteGroup, useDeleteHost, useGroups, useHosts } from "./api";

const UNGROUPED = "__ungrouped__";

/**
 * The host explorer: hosts grouped into collapsible sections, filterable,
 * with connect / SFTP / edit / delete on every row's context menu.
 * Double-click connects, mirroring how editors open files.
 */
export function HostsView() {
  const { t } = useI18n();
  const { data: hosts = [], isLoading } = useHosts();
  const { data: groups = [] } = useGroups();
  const deleteHost = useDeleteHost();
  const deleteGroup = useDeleteGroup();
  const openHostForm = useOverlayStore((s) => s.openHostForm);
  const openGroupForm = useOverlayStore((s) => s.openGroupForm);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
      // While filtering, hide groups with no matches; otherwise show every
      // group so even empty ones can be renamed or deleted in place.
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
      description: t("hosts.deleteHost.description", { label: host.label }),
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
        : t("hosts.deleteGroup.description", { name: section.name }),
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
  onEdit,
  onDelete,
}: {
  host: Host;
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onDoubleClick={() => openTerminal(host)}
          className="group flex cursor-default items-center gap-2 rounded-md py-1 pl-6 pr-2 hover:bg-list-hover"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              connected ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          <span className="truncate text-sm">{host.label}</span>
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {host.username ? `${host.username}@` : ""}
            {host.address}
          </span>
          <Tooltip content={t("hosts.connect")}>
            <button
              onClick={() => openTerminal(host)}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
            >
              <Plug className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => openTerminal(host)}>
          <Plug /> {t("hosts.connect")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={openSftp}>
          <FolderSync /> {t("hosts.openSftp")}
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
