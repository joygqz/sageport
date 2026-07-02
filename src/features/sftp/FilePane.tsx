import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  FolderPlus,
  HardDrive,
  Plus,
  RefreshCw,
  Server,
  X,
} from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useHosts } from "@/features/hosts/api";
import { dragState } from "./dnd";
import { FileList } from "./FileList";
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
  const refresh = useSftpStore((s) => s.refresh);
  const transfer = useSftpStore((s) => s.transfer);
  const { data: hosts = [] } = useHosts();

  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const active = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;

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

  const onDelete = async (tab: SftpTab, entry: FileEntry) => {
    const ok = await ask(t("sftp.deleteConfirm", { name: entry.name }), {
      title: t("common.delete"),
      kind: "warning",
    });
    if (!ok) return;
    try {
      await ipc.sftp.remove(tab.connectionId, entry.path, entry.kind === "dir");
      await refresh(side, tab.id);
    } catch (err) {
      toast.error(t("sftp.deleteError"), errorMessage(err));
    }
  };

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (dragState.fromSide && dragState.fromSide !== side)
          e.preventDefault();
      }}
      onDrop={(e) => {
        if (dragState.fromSide && dragState.fromSide !== side) {
          e.preventDefault();
          void transfer(dragState.fromSide, dragState.entries);
          dragState.fromSide = null;
          dragState.entries = [];
        }
      }}
    >
      {/* Tab bar */}
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-1.5">
        {pane.tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActive(side, tab.id)}
            className={cn(
              "group flex h-6 cursor-default items-center gap-1.5 rounded px-2 text-xs",
              tab.id === pane.activeTabId
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
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
          {/* Path / actions toolbar */}
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-background px-1.5">
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
                onClick={() => onMkdir(active)}
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </Tooltip>
            <PathBar key={active.cwd} side={side} tab={active} />
          </div>

          <FileList
            side={side}
            tab={active}
            onRename={(entry) => onRename(active, entry)}
            onDelete={(entry) => void onDelete(active, entry)}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
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
    </div>
  );
}

/**
 * Editable address bar: shows the active tab's cwd and lets the user type a
 * path to jump to. Remounted via `key={cwd}` so the input re-syncs after every
 * navigation. Enter navigates; Escape reverts and blurs.
 */
function PathBar({ side, tab }: { side: PaneSide; tab: SftpTab }) {
  const { t } = useI18n();
  const navigate = useSftpStore((s) => s.navigate);
  const [value, setValue] = useState(tab.cwd);
  const ref = useRef<HTMLInputElement>(null);

  // Scroll to the tail so the deepest part of a long path stays visible when
  // the field is not focused (kept LTR so the caret behaves normally).
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
      className="ml-1 h-6 flex-1 rounded border-transparent bg-transparent px-2 text-xs text-muted-foreground shadow-none transition-colors hover:border-border focus-visible:bg-surface focus-visible:text-foreground"
    />
  );
}
