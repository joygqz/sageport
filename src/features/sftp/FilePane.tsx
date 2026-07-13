import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  HardDrive,
  History,
  Plus,
  RefreshCw,
  Server,
  X,
} from "lucide-react";

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useHosts } from "@/features/hosts/api";
import { FileList } from "./FileList";
import { BookmarkMenu } from "./BookmarkMenu";
import { PermissionsDialog } from "./PermissionsDialog";
import { PromptDialog, type PromptState } from "./PromptDialog";
import {
  joinPath,
  parentPath,
  useSftpStore,
  type PaneSide,
  type SftpTab,
  type TabStatus,
} from "./store";

const statusColor: Record<TabStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export function FilePane({ side }: { side: PaneSide }) {
  const { t } = useI18n();
  const pane = useSftpStore((s) => s.panes[side]);
  const addLocalTab = useSftpStore((s) => s.addLocalTab);
  const addRemoteTab = useSftpStore((s) => s.addRemoteTab);
  const closeTab = useSftpStore((s) => s.closeTab);
  const setActive = useSftpStore((s) => s.setActive);
  const navigate = useSftpStore((s) => s.navigate);
  const navigateToHistory = useSftpStore((s) => s.navigateToHistory);
  const refresh = useSftpStore((s) => s.refresh);
  const { data: hosts = [] } = useHosts();

  const tabStripRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [permTarget, setPermTarget] = useState<{
    tab: SftpTab;
    entry: FileEntry;
  } | null>(null);
  const active = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
  const activeReady =
    !!active?.cwd &&
    !active.loading &&
    (active.kind === "local" || active.status === "connected");

  const onMkdir = (tab: SftpTab) =>
    setPrompt({
      title: t("sftp.newFolder"),
      initial: "",
      confirmLabel: t("common.add"),
      onConfirm: async (name) => {
        try {
          await ipc.sftp.mkdir(tab.connectionId, joinPath(tab.cwd, name));
          await refresh(side, tab.id);
        } catch (err) {
          toast.error(t("sftp.mkdirError"), errorMessage(err));
        }
      },
    });

  const onRename = (tab: SftpTab, entry: FileEntry) =>
    setPrompt({
      title: t("sftp.rename"),
      initial: entry.name,
      confirmLabel: t("common.save"),
      onConfirm: async (name) => {
        try {
          await ipc.sftp.rename(
            tab.connectionId,
            entry.path,
            joinPath(parentPath(entry.path), name),
          );
          await refresh(side, tab.id);
        } catch (err) {
          toast.error(t("sftp.renameError"), errorMessage(err));
        }
      },
    });

  const onDelete = async (tab: SftpTab, entries: FileEntry[]) => {
    let changed = false;
    try {
      for (const entry of entries) {
        await ipc.sftp.remove(
          tab.connectionId,
          entry.path,
          entry.kind === "dir",
        );
        changed = true;
      }
    } catch (err) {
      toast.error(t("sftp.deleteError"), errorMessage(err));
    } finally {
      if (changed) await refresh(side, tab.id);
    }
  };

  const confirmDelete = (tab: SftpTab, entries: FileEntry[]) => {
    const [entry] = entries;
    if (!entry) return;
    setConfirmState({
      title: t("common.delete"),
      description:
        entries.length === 1
          ? t("common.deleteConfirm", { name: entry.name })
          : t("sftp.deleteManyConfirm", { count: entries.length }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () => void onDelete(tab, entries),
        },
      ],
    });
  };

  return (
    <div
      data-file-pane-side={side}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div
        ref={tabStripRef}

        onWheel={(e) => {
          const el = tabStripRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          el.scrollLeft += e.deltaX + e.deltaY;
        }}
        className="scrollbar-none flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface/65 px-1.5"
      >
        {pane.tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActive(side, tab.id)}
            onDoubleClick={() => {
              if (tab.kind === "local") {
                void addLocalTab(side);
                return;
              }
              const host = hosts.find((h) => h.id === tab.hostId);
              if (host) addRemoteTab(side, host);
            }}
            className={cn(
              "group flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs outline-none transition-[background-color,color,box-shadow]",
              tab.id === pane.activeTabId
                ? "bg-card text-card-foreground shadow-sm"
                : "text-muted-foreground hover:bg-list-hover hover:text-foreground",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", statusColor[tab.status])}
            />
            {tab.kind === "local" ? (
              <HardDrive className="size-3" />
            ) : (
              <Server className="size-3" />
            )}
            <span className="max-w-32 truncate">
              {tab.kind === "local" ? t("sftp.local") : tab.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(side, tab.id);
              }}
              className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

        <DropdownMenu>
          <Tooltip content={t("sftp.newTab")}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-6 shrink-0">
                <Plus className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
            <DropdownMenuItem onSelect={() => void addLocalTab(side)}>
              <HardDrive /> {t("sftp.local")}
            </DropdownMenuItem>
            {hosts.length > 0 && <DropdownMenuSeparator />}
            {hosts.map((host) => (
              <DropdownMenuItem
                key={host.id}
                onSelect={() => addRemoteTab(side, host)}
              >
                <Server /> {host.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {active ? (
        <>
          <div className="flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-background px-1.5">
            <Tooltip content={t("sftp.back")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={!activeReady || active.historyIndex <= 0}
                onClick={() =>
                  void navigateToHistory(
                    side,
                    active.id,
                    active.historyIndex - 1,
                  )
                }
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.forward")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={
                  !activeReady ||
                  active.historyIndex >= active.history.length - 1
                }
                onClick={() =>
                  void navigateToHistory(
                    side,
                    active.id,
                    active.historyIndex + 1,
                  )
                }
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </Tooltip>
            <DropdownMenu>
              <Tooltip content={t("sftp.navigationHistory")}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    disabled={!activeReady || active.history.length <= 1}
                  >
                    <History className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent
                align="start"
                className="max-h-80 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto"
              >
                <DropdownMenuLabel>
                  {t("sftp.navigationHistory")}
                </DropdownMenuLabel>
                {[...active.history].reverse().map((path, reverseIndex) => {
                  const historyIndex = active.history.length - reverseIndex - 1;
                  const current = historyIndex === active.historyIndex;
                  return (
                    <DropdownMenuItem
                      key={`${historyIndex}:${path}`}
                      disabled={current}
                      title={path}
                      onSelect={() =>
                        void navigateToHistory(side, active.id, historyIndex)
                      }
                    >
                      <Check
                        className={cn("size-3.5", !current && "invisible")}
                      />
                      <span className="truncate">{path}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip content={t("sftp.up")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={!active.cwd || parentPath(active.cwd) === active.cwd}
                onClick={() =>
                  void navigate(side, active.id, parentPath(active.cwd))
                }
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.refresh")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={!activeReady}
                onClick={() => void refresh(side, active.id)}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.newFolder")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                disabled={!activeReady}
                onClick={() => onMkdir(active)}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </Tooltip>
            <BookmarkMenu side={side} tab={active} />
            <PathBar key={active.cwd} side={side} tab={active} />
          </div>

          <FileList
            side={side}
            tab={active}
            onRename={(entry) => onRename(active, entry)}
            onDelete={(entries) => confirmDelete(active, entries)}
            onPermissions={(entry) => setPermTarget({ tab: active, entry })}
          />
        </>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <EmptyState
            className="m-auto p-3"
            icon={HardDrive}
            title={t("sftp.noTabTitle")}
            action={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <Plus /> {t("sftp.newTab")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="center"
                  className="max-h-80 overflow-auto"
                >
                  <DropdownMenuItem onSelect={() => void addLocalTab(side)}>
                    <HardDrive /> {t("sftp.local")}
                  </DropdownMenuItem>
                  {hosts.length > 0 && <DropdownMenuSeparator />}
                  {hosts.map((host) => (
                    <DropdownMenuItem
                      key={host.id}
                      onSelect={() => addRemoteTab(side, host)}
                    >
                      <Server /> {host.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </div>
      )}

      <PromptDialog state={prompt} onClose={() => setPrompt(null)} />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
      <PermissionsDialog
        connectionId={permTarget?.tab.connectionId ?? null}
        entry={permTarget?.entry ?? null}
        onClose={() => setPermTarget(null)}
        onSaved={() => {
          if (permTarget) void refresh(side, permTarget.tab.id);
        }}
      />
    </div>
  );
}

function PathBar({ side, tab }: { side: PaneSide; tab: SftpTab }) {
  const { t } = useI18n();
  const navigate = useSftpStore((s) => s.navigate);
  const [value, setValue] = useState(tab.cwd);
  const ref = useRef<HTMLInputElement>(null);

  const scrollToEnd = () => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  };
  useEffect(scrollToEnd, [value]);

  return (
    <Input
      ref={ref}
      value={value}
      spellCheck={false}
      autoComplete="off"
      placeholder={t("sftp.pathPlaceholder")}
      title={tab.cwd}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const next = value.trim();
          if (next && next !== tab.cwd) void navigate(side, tab.id, next);
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setValue(tab.cwd);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setValue(tab.cwd);
        scrollToEnd();
      }}
      className="ml-1 h-7 min-w-0 flex-1 rounded-lg border-transparent bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:border-input hover:bg-surface/50 focus-visible:bg-surface focus-visible:text-foreground"
    />
  );
}
