import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { File, Folder, FolderSymlink, Loader2, WifiOff } from "lucide-react";

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ScrollArea,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useTabsStore } from "@/workbench/tabs";
import { nextFileSelection } from "./selection";
import {
  MAX_EDIT_BYTES,
  parentPath,
  useSftpStore,
  type PaneSide,
  type SftpTab,
} from "./store";

interface FileDragState {
  entry: FileEntry;
  entries: FileEntry[];
  clientX: number;
  clientY: number;
  rect: DOMRect;
}

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
  onPermissions,
}: {
  side: PaneSide;
  tab: SftpTab;
  onRename: (entry: FileEntry) => void;
  onDelete: (entries: FileEntry[]) => void;
  onPermissions: (entry: FileEntry) => void;
}) {
  const { t } = useI18n();
  const navigate = useSftpStore((s) => s.navigate);
  const setSelected = useSftpStore((s) => s.setSelected);
  const transfer = useSftpStore((s) => s.transfer);
  const reconnectTab = useSftpStore((s) => s.reconnectTab);
  const showHidden = useSftpStore((s) => s.showHidden);
  const openFile = useTabsStore((s) => s.openFile);
  const [dragState, setDragState] = useState<FileDragState | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    entry: FileEntry;
    entries: FileEntry[];
    active: boolean;
  } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);

  const entries = showHidden
    ? tab.entries
    : tab.entries.filter((entry) => !entry.name.startsWith("."));
  const visiblePaths = entries.map((entry) => entry.path);

  useEffect(() => {
    selectionAnchorRef.current = null;
  }, [tab.id, tab.cwd]);

  useEffect(() => {
    if (!dragState) return;

    const style = document.createElement("style");
    style.textContent = "* { cursor: default !important; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [dragState]);

  const openEditor = (entry: FileEntry) => {
    if (entry.size > MAX_EDIT_BYTES) {
      toast.error(t("sftp.editor.tooLarge"));
      return;
    }
    openFile({
      connectionId: tab.connectionId,
      path: entry.path,
      name: entry.name,
    });
  };

  const open = (entry: FileEntry) => {
    if (entry.kind === "dir") void navigate(side, tab.id, entry.path);
    else openEditor(entry);
  };

  const onRowClick = (e: React.MouseEvent, entry: FileEntry) => {
    if (suppressClickRef.current === entry.path) {
      suppressClickRef.current = null;
      return;
    }
    const next = nextFileSelection({
      paths: visiblePaths,
      selected: tab.selected,
      target: entry.path,
      anchor: selectionAnchorRef.current,
      toggle: e.metaKey || e.ctrlKey,
      range: e.shiftKey,
    });
    selectionAnchorRef.current = next.anchor;
    setSelected(side, tab.id, next.selected);
  };

  const toggleEntry = (entry: FileEntry) => {
    const next = nextFileSelection({
      paths: visiblePaths,
      selected: tab.selected,
      target: entry.path,
      anchor: selectionAnchorRef.current,
      toggle: true,
    });
    selectionAnchorRef.current = next.anchor;
    setSelected(side, tab.id, next.selected);
  };

  const handlePointerDown = (
    e: ReactPointerEvent<HTMLTableRowElement>,
    entry: FileEntry,
    entries: FileEntry[],
  ) => {
    if (e.button !== 0) return;
    e.currentTarget.closest("table")?.focus();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      entry,
      entries,
      active: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLTableRowElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(
        e.clientX - drag.startX,
        e.clientY - drag.startY,
      );
      if (distance < 5) return;
      drag.active = true;
      setDragState({
        entry: drag.entry,
        entries: drag.entries,
        clientX: e.clientX,
        clientY: e.clientY,
        rect: e.currentTarget.getBoundingClientRect(),
      });
    }

    e.preventDefault();
    setDragState((current) =>
      current
        ? { ...current, clientX: e.clientX, clientY: e.clientY }
        : current,
    );
  };

  const finishPointerDrag = (e: ReactPointerEvent<HTMLTableRowElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) e.preventDefault();
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (e.type !== "pointercancel" && drag.active) {
      const targetSide = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-file-pane-side]")?.dataset
        .filePaneSide as PaneSide | undefined;
      if (targetSide && targetSide !== side) {
        void transfer(side, drag.entries);
      }
      suppressClickRef.current = drag.entry.path;
      window.setTimeout(() => {
        if (suppressClickRef.current === drag.entry.path) {
          suppressClickRef.current = null;
        }
      }, 0);
    }
    setDragState(null);
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
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          {tab.kind === "remote" && <WifiOff className="size-6 text-danger" />}
          <p className="text-xs text-danger">{tab.error}</p>
          {tab.kind === "remote" && tab.status === "error" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => reconnectTab(side, tab.id)}
            >
              {t("terminal.reconnect")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const canGoUp = !!tab.cwd && parentPath(tab.cwd) !== tab.cwd;
  const sendLabel = side === "left" ? t("sftp.sendRight") : t("sftp.sendLeft");

  return (
    <ScrollArea className="min-h-0 flex-1">
      <table
        tabIndex={0}
        aria-label={t("sftp.fileList")}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "a") {
            event.preventDefault();
            setSelected(side, tab.id, visiblePaths);
          }
        }}
        className="w-full table-fixed border-collapse text-xs outline-none"
      >
        <colgroup>
          <col className="w-7" />
          <col />
          <col className="w-14" />
          <col className="w-30" />
        </colgroup>
        <tbody>
          {canGoUp && (
            <tr
              onDoubleClick={() =>
                void navigate(side, tab.id, parentPath(tab.cwd))
              }
              className="cursor-pointer select-none hover:bg-accent"
            >
              <td colSpan={4} className="px-2 py-1 text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Folder className="size-4 shrink-0" /> ..
                </span>
              </td>
            </tr>
          )}

          {entries.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <EmptyState
                  className="py-8"
                  icon={Folder}
                  title={t("sftp.emptyDir")}
                />
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const selected = tab.selected.includes(entry.path);
              const actionEntries = selected
                ? entries.filter((item) => tab.selected.includes(item.path))
                : [entry];
              const single = actionEntries.length === 1;
              return (
                <ContextMenu key={entry.path}>
                  <ContextMenuTrigger asChild>
                    <tr
                      onPointerDown={(e) =>
                        handlePointerDown(
                          e,
                          entry,
                          selected
                            ? entries.filter((item) =>
                                tab.selected.includes(item.path),
                              )
                            : [entry],
                        )
                      }
                      onPointerMove={handlePointerMove}
                      onPointerUp={finishPointerDrag}
                      onPointerCancel={finishPointerDrag}
                      onClick={(e) => onRowClick(e, entry)}
                      onContextMenu={() => {
                        if (!selected) {
                          selectionAnchorRef.current = entry.path;
                          setSelected(side, tab.id, [entry.path]);
                        }
                      }}
                      onDoubleClick={() => open(entry)}
                      className={cn(
                        "cursor-pointer touch-none select-none",
                        selected ? "bg-primary/15" : "hover:bg-accent",
                        dragState?.entry.path === entry.path && "opacity-50",
                      )}
                    >
                      <td className="py-1 pl-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          aria-label={t("sftp.selectFile", {
                            name: entry.name,
                          })}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleEntry(entry)}
                          className="block size-3 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="truncate py-1 pl-2 pr-1">
                        <span className="inline-flex max-w-full items-center gap-2">
                          <EntryIcon entry={entry} />
                          <span className="truncate">{entry.name}</span>
                        </span>
                      </td>
                      <td className="truncate px-1 py-1 text-right text-muted-foreground">
                        {entry.kind === "dir" ? "" : formatSize(entry.size)}
                      </td>
                      <td className="truncate py-1 pl-1 pr-2 text-right text-muted-foreground">
                        {formatTime(entry.modified)}
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => void transfer(side, actionEntries)}
                    >
                      {sendLabel}
                    </ContextMenuItem>
                    {single && entry.kind === "dir" && (
                      <ContextMenuItem
                        onSelect={() => void navigate(side, tab.id, entry.path)}
                      >
                        {t("sftp.open")}
                      </ContextMenuItem>
                    )}
                    {single && entry.kind === "file" && (
                      <ContextMenuItem onSelect={() => openEditor(entry)}>
                        {t("common.edit")}
                      </ContextMenuItem>
                    )}
                    {single && <ContextMenuSeparator />}
                    {single && (
                      <ContextMenuItem onSelect={() => onRename(entry)}>
                        {t("sftp.rename")}
                      </ContextMenuItem>
                    )}
                    {single &&
                      entry.permissions !== null &&
                      !entry.isSymlink && (
                        <ContextMenuItem onSelect={() => onPermissions(entry)}>
                          {t("sftp.permissions.action")}
                        </ContextMenuItem>
                      )}
                    <ContextMenuItem
                      destructive
                      onSelect={() => onDelete(actionEntries)}
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
      {dragState && <FileDragGhost dragState={dragState} />}
    </ScrollArea>
  );
}

function FileDragGhost({ dragState }: { dragState: FileDragState }) {
  const { entry, entries } = dragState;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[100] flex items-center gap-2 border border-border bg-background px-2 text-xs text-foreground opacity-90 shadow-lg"
      style={{
        left: dragState.clientX,
        top: dragState.clientY,
        width: dragState.rect.width,
        height: dragState.rect.height,
      }}
    >
      <EntryIcon entry={entry} />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {entries.length > 1 && (
        <span className="shrink-0 text-muted-foreground">
          +{entries.length - 1}
        </span>
      )}
      <span className="shrink-0 text-muted-foreground">
        {entry.kind === "dir" ? "" : formatSize(entry.size)}
      </span>
    </div>
  );
}
