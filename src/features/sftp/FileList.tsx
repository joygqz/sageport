import { File, Folder, FolderSymlink, Loader2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ScrollArea,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { dragState } from "./dnd";
import { parentPath, useSftpStore, type PaneSide, type SftpTab } from "./store";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(secs: number | null): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EntryIcon({ entry }: { entry: FileEntry }) {
  if (entry.kind === "dir")
    return <Folder className="size-4 shrink-0 text-info" />;
  if (entry.isSymlink)
    return <FolderSymlink className="size-4 shrink-0 text-muted-foreground" />;
  return <File className="size-4 shrink-0 text-muted-foreground" />;
}

export function FileList({
  side,
  tab,
  onRename,
  onDelete,
}: {
  side: PaneSide;
  tab: SftpTab;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  const { t } = useI18n();
  const navigate = useSftpStore((s) => s.navigate);
  const setSelected = useSftpStore((s) => s.setSelected);
  const transfer = useSftpStore((s) => s.transfer);

  const open = (entry: FileEntry) => {
    if (entry.kind === "dir") void navigate(side, tab.id, entry.path);
    else void transfer(side, [entry]);
  };

  const onRowClick = (e: React.MouseEvent, entry: FileEntry) => {
    const multi = e.metaKey || e.ctrlKey;
    if (multi) {
      const next = tab.selected.includes(entry.path)
        ? tab.selected.filter((p) => p !== entry.path)
        : [...tab.selected, entry.path];
      setSelected(side, tab.id, next);
    } else {
      setSelected(side, tab.id, [entry.path]);
    }
  };

  if (tab.loading && tab.entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tab.error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center text-xs text-destructive">{tab.error}</p>
      </div>
    );
  }

  const canGoUp = !!tab.cwd && parentPath(tab.cwd) !== tab.cwd;
  const sendLabel = side === "left" ? t("sftp.sendRight") : t("sftp.sendLeft");
  const compressedLabel =
    side === "left"
      ? t("sftp.sendRightCompressed")
      : t("sftp.sendLeftCompressed");

  return (
    <ScrollArea className="min-h-0 flex-1">
      <table className="w-full table-fixed border-collapse text-xs">
        <tbody>
          {canGoUp && (
            <tr
              onDoubleClick={() =>
                void navigate(side, tab.id, parentPath(tab.cwd))
              }
              className="cursor-pointer select-none hover:bg-accent"
            >
              <td colSpan={3} className="px-2 py-1 text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Folder className="size-4 shrink-0" /> ..
                </span>
              </td>
            </tr>
          )}

          {tab.entries.length === 0 ? (
            <tr>
              <td colSpan={3}>
                <EmptyState
                  className="py-8"
                  icon={Folder}
                  title={t("sftp.emptyDir")}
                />
              </td>
            </tr>
          ) : (
            tab.entries.map((entry) => {
              const selected = tab.selected.includes(entry.path);
              return (
                <ContextMenu key={entry.path}>
                  <ContextMenuTrigger asChild>
                    <tr
                      draggable
                      onDragStart={() => {
                        dragState.fromSide = side;
                        dragState.entries = selected
                          ? tab.entries.filter((e) =>
                              tab.selected.includes(e.path),
                            )
                          : [entry];
                      }}
                      onClick={(e) => onRowClick(e, entry)}
                      onDoubleClick={() => open(entry)}
                      className={cn(
                        "cursor-pointer select-none",
                        selected ? "bg-primary/15" : "hover:bg-accent",
                      )}
                    >
                      <td className="truncate px-2 py-1">
                        <span className="inline-flex items-center gap-2">
                          <EntryIcon entry={entry} />
                          <span className="truncate">{entry.name}</span>
                        </span>
                      </td>
                      <td className="w-24 px-2 py-1 text-right text-muted-foreground">
                        {entry.kind === "dir" ? "" : formatSize(entry.size)}
                      </td>
                      <td className="w-36 px-2 py-1 text-right text-muted-foreground">
                        {formatTime(entry.modified)}
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => void transfer(side, [entry])}
                    >
                      {sendLabel}
                    </ContextMenuItem>
                    {entry.kind === "dir" && (
                      <ContextMenuItem
                        onSelect={() =>
                          void transfer(side, [entry], { compress: true })
                        }
                      >
                        {compressedLabel}
                      </ContextMenuItem>
                    )}
                    {entry.kind === "dir" && (
                      <ContextMenuItem
                        onSelect={() => void navigate(side, tab.id, entry.path)}
                      >
                        {t("sftp.open")}
                      </ContextMenuItem>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onRename(entry)}>
                      {t("sftp.rename")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      destructive
                      onSelect={() => onDelete(entry)}
                    >
                      {t("common.delete")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })
          )}
        </tbody>
      </table>
    </ScrollArea>
  );
}
