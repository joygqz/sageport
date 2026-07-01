import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plug,
  Plus,
  Server,
  Trash2,
} from "lucide-react";

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  ResizeHandle,
  ScrollArea,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import { openGroupsWindow } from "@/lib/windows";
import type { Host } from "@/types/models";
import { useSessionStore } from "@/features/terminal/sessionStore";
import { useDeleteGroup, useDeleteHost, useGroups, useHosts } from "./api";

const UNGROUPED = "__ungrouped__";
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const clampWidth = (w: number) => Math.max(MIN_WIDTH, Math.min(w, MAX_WIDTH));

interface HostSidebarProps {
  onConnect: (host: Host) => void;
  onNewHost: () => void;
  onEditHost: (host: Host) => void;
}

export function HostSidebar({
  onConnect,
  onNewHost,
  onEditHost,
}: HostSidebarProps) {
  const { t } = useI18n();
  const { data: hosts = [], isLoading } = useHosts();
  const { data: groups = [] } = useGroups();
  const deleteHost = useDeleteHost();
  const deleteGroup = useDeleteGroup();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(288);

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

  const searching = query.trim().length > 0;

  const sections = useMemo(() => {
    const byGroup = new Map<string, Host[]>();
    for (const host of filtered) {
      const key = host.groupId ?? UNGROUPED;
      const list = byGroup.get(key) ?? [];
      list.push(host);
      byGroup.set(key, list);
    }
    const ordered = groups
      .map((g) => ({ id: g.id, name: g.name, hosts: byGroup.get(g.id) ?? [] }))
      // When searching, hide groups with no matches; otherwise show every
      // group so even empty ones can be edited or deleted in place.
      .filter((s) => !searching || s.hosts.length > 0);
    const ungrouped = byGroup.get(UNGROUPED) ?? [];
    if (ungrouped.length > 0) {
      ordered.push({
        id: UNGROUPED,
        name: t("sidebar.ungrouped"),
        hosts: ungrouped,
      });
    }
    return ordered;
  }, [filtered, groups, searching, t]);

  const onDeleteHost = async (host: Host) => {
    try {
      await deleteHost.mutateAsync(host.id);
      toast.success(t("sidebar.hostDeleted"), host.label);
    } catch (err) {
      toast.error(t("sidebar.deleteError"), errorMessage(err));
    }
  };

  const onDeleteGroup = async (id: string, name: string) => {
    try {
      await deleteGroup.mutateAsync(id);
      toast.success(t("sidebar.groupDeleted"), name);
    } catch (err) {
      toast.error(t("sidebar.deleteGroupError"), errorMessage(err));
    }
  };

  return (
    <>
      <aside style={{ width }} className="flex shrink-0 flex-col bg-sidebar">
        <div className="flex items-center gap-2 p-2.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sidebar.filterPlaceholder")}
            className="h-8 bg-background"
          />
          <DropdownMenu>
            <Tooltip content={t("sidebar.add")}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-8 shrink-0"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onNewHost}>
                <Server />
                {t("common.newHost")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void openGroupsWindow()}>
                <FolderPlus />
                {t("common.newGroup")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-2 pb-4">
            {isLoading ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {t("common.loading")}
              </p>
            ) : sections.length === 0 ? (
              <EmptyState
                icon={Server}
                title={
                  query ? t("sidebar.noMatchesTitle") : t("sidebar.emptyTitle")
                }
                description={
                  query
                    ? t("sidebar.noMatchesDescription")
                    : t("sidebar.emptyDescription")
                }
                action={
                  !query && (
                    <Button size="sm" onClick={onNewHost}>
                      <Plus /> {t("common.newHost")}
                    </Button>
                  )
                }
              />
            ) : (
              sections.map((section) => {
                const isCollapsed = collapsed[section.id];
                return (
                  <div key={section.id} className="mb-1">
                    <GroupSection
                      id={section.id}
                      name={section.name}
                      count={section.hosts.length}
                      collapsed={isCollapsed}
                      onToggle={() =>
                        setCollapsed((c) => ({
                          ...c,
                          [section.id]: !c[section.id],
                        }))
                      }
                      onEdit={() => void openGroupsWindow(section.id)}
                      onDelete={() => onDeleteGroup(section.id, section.name)}
                    />
                    {!isCollapsed &&
                      section.hosts.map((host) => (
                        <HostRow
                          key={host.id}
                          host={host}
                          onConnect={onConnect}
                          onEdit={onEditHost}
                          onDelete={onDeleteHost}
                        />
                      ))}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </aside>
      <ResizeHandle
        axis="x"
        size={width}
        onResize={(w) => setWidth(clampWidth(w))}
      />
    </>
  );
}

function GroupSection({
  id,
  name,
  count,
  collapsed,
  onToggle,
  onEdit,
  onDelete,
}: {
  id: string;
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const isGroup = id !== UNGROUPED;

  const header = (
    <div className="group flex items-center rounded text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
      <button
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1.5"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{name}</span>
        <span className="ml-auto font-normal normal-case">{count}</span>
      </button>
      {isGroup && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="mr-1 size-6 shrink-0 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  if (!isGroup) return header;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onEdit}>
          <Pencil /> {t("common.edit")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 /> {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HostRow({
  host,
  onConnect,
  onEdit,
  onDelete,
}: {
  host: Host;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
  onDelete: (host: Host) => void;
}) {
  const { t } = useI18n();
  const connected = useSessionStore((s) =>
    s.sessions.some((x) => x.hostId === host.id && x.status === "connected"),
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onDoubleClick={() => onConnect(host)}
          className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              connected ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium leading-tight">{host.label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {host.username ? `${host.username}@` : ""}
              {host.address}
            </p>
          </div>
          <Tooltip content={t("common.connect")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 opacity-0 group-hover:opacity-100"
              onClick={() => onConnect(host)}
            >
              <Plug className="size-3.5" />
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onConnect(host)}>
                <Plug /> {t("common.connect")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(host)}>
                <Pencil /> {t("common.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => onDelete(host)}>
                <Trash2 /> {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onConnect(host)}>
          <Plug /> {t("common.connect")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onEdit(host)}>
          <Pencil /> {t("common.edit")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={() => onDelete(host)}>
          <Trash2 /> {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
