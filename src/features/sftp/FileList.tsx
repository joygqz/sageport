import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines,
  Database,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileSpreadsheet,
  FileSymlink,
  FileText,
  FileVideo,
  Folder,
  FolderSymlink,
  Loader2,
  Package,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

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
import { layoutDragPreview } from "@/lib/dragPreview";
import { useDragCursor } from "@/lib/pointerDrag";
import { toast } from "@/lib/toast";
import { cn, formatBytes } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useTabsStore } from "@/workbench/tabs";
import { fileIconKind, type FileIconKind } from "./file-icon";
import {
  inlineCreateBlurAction,
  inlineCreateRowIndex,
} from "./file-list-layout";
import { nextFileSelection } from "./selection";
import {
  MAX_EDIT_BYTES,
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

const FILE_ICONS: Record<
  FileIconKind,
  { icon: LucideIcon; className: string }
> = {
  archive: { icon: FileArchive, className: "text-warning" },
  audio: { icon: AudioLines, className: "text-primary" },
  code: { icon: FileCode, className: "text-info" },
  config: { icon: FileCog, className: "text-muted-foreground" },
  database: { icon: Database, className: "text-info" },
  file: { icon: File, className: "text-muted-foreground" },
  image: { icon: FileImage, className: "text-success" },
  key: { icon: FileKey, className: "text-warning" },
  package: { icon: Package, className: "text-primary" },
  spreadsheet: { icon: FileSpreadsheet, className: "text-success" },
  text: { icon: FileText, className: "text-muted-foreground" },
  video: { icon: FileVideo, className: "text-primary" },
};

function EntryIcon({ entry }: { entry: FileEntry }) {
  const className = "size-4 shrink-0";
  if (entry.isSymlink || entry.kind === "symlink") {
    const Icon = entry.kind === "dir" ? FolderSymlink : FileSymlink;
    return <Icon aria-hidden="true" className={cn(className, "text-info")} />;
  }
  if (entry.kind === "dir") {
    return (
      <Folder aria-hidden="true" className={cn(className, "text-warning")} />
    );
  }

  const { icon: Icon, className: color } = FILE_ICONS[fileIconKind(entry.name)];
  return <Icon aria-hidden="true" className={cn(className, color)} />;
}

export function FileList({
  side,
  tab,
  creating,
  onCreate,
  onCancelCreate,
  onRename,
  onDelete,
  onPermissions,
}: {
  side: PaneSide;
  tab: SftpTab;
  creating: "file" | "folder" | null;
  onCreate: (name: string) => Promise<boolean>;
  onCancelCreate: () => void;
  onRename: (entry: FileEntry, name: string) => Promise<boolean>;
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
  const [renameTarget, setRenameTarget] = useState<{
    tabId: string;
    cwd: string;
    path: string;
  } | null>(null);
  const pendingContextMenuRenameRef = useRef<{
    tabId: string;
    cwd: string;
    path: string;
  } | null>(null);
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
    : tab.entries.filter(
        (entry) => !(entry.hidden ?? entry.name.startsWith(".")),
      );
  const visiblePaths = entries.map((entry) => entry.path);
  const renamingPath =
    renameTarget?.tabId === tab.id && renameTarget.cwd === tab.cwd
      ? renameTarget.path
      : null;
  const inlineCreateIndex = creating
    ? inlineCreateRowIndex(entries, creating)
    : 0;
  const rows: Array<
    | { type: "entry"; entry: FileEntry }
    | { type: "create"; kind: "file" | "folder" }
  > = entries.map((entry) => ({ type: "entry", entry }));
  if (creating) {
    rows.splice(inlineCreateIndex, 0, { type: "create", kind: creating });
  }

  useEffect(() => {
    selectionAnchorRef.current = null;
  }, [tab.id, tab.cwd]);

  useDragCursor(dragState !== null);

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

  const startRenaming = (entry: FileEntry) => {
    setRenameTarget({ tabId: tab.id, cwd: tab.cwd, path: entry.path });
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

  if (tab.loading) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
        <span className="text-xs">{t("sftp.loading")}</span>
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

  const sendLabel = side === "left" ? t("sftp.sendRight") : t("sftp.sendLeft");

  return (
    <ScrollArea className="min-h-0 flex-1">
      <table
        tabIndex={0}
        aria-label={t("sftp.fileList")}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const isEditing =
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target.isContentEditable;
          if (isEditing) return;

          if ((event.metaKey || event.ctrlKey) && event.key === "a") {
            event.preventDefault();
            setSelected(side, tab.id, visiblePaths);
          } else if (event.key === "Delete" && !event.repeat) {
            const selectedEntries = entries.filter((entry) =>
              tab.selected.includes(entry.path),
            );
            if (selectedEntries.length > 0) {
              event.preventDefault();
              onDelete(selectedEntries);
            }
          } else if (event.key === "F2" && !event.repeat) {
            const selectedEntries = entries.filter((entry) =>
              tab.selected.includes(entry.path),
            );
            const [selectedEntry] = selectedEntries;
            if (selectedEntries.length === 1 && selectedEntry) {
              event.preventDefault();
              startRenaming(selectedEntry);
            }
          }
        }}
        className="w-full table-fixed border-collapse text-xs outline-none"
      >
        <colgroup>
          <col />
          <col className="w-14" />
          <col className="w-30" />
        </colgroup>
        <tbody>
          {entries.length === 0 && !creating ? (
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
            rows.map((row) => {
              if (row.type === "create") {
                return (
                  <InlineCreateRow
                    key="create"
                    kind={row.kind}
                    onCreate={onCreate}
                    onCancel={onCancelCreate}
                  />
                );
              }

              const { entry } = row;
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
                        "h-7 cursor-pointer touch-none select-none transition-colors",
                        selected
                          ? "bg-list-active text-list-active-foreground"
                          : "hover:bg-list-hover",
                        dragState?.entries.some(
                          (draggedEntry) => draggedEntry.path === entry.path,
                        ) && "opacity-50",
                      )}
                    >
                      <td className="h-7 truncate pl-2.5 pr-1 align-middle">
                        <span className="flex h-7 max-w-full items-center gap-2">
                          <EntryIcon entry={entry} />
                          {renamingPath === entry.path ? (
                            <InlineNameInput
                              initialValue={entry.name}
                              ariaLabel={t("sftp.rename")}
                              onSubmit={async (name) => {
                                const renamed = await onRename(entry, name);
                                if (renamed) setRenameTarget(null);
                                return renamed;
                              }}
                              onCancel={() => setRenameTarget(null)}
                            />
                          ) : (
                            <span className="truncate">{entry.name}</span>
                          )}
                        </span>
                      </td>
                      <td
                        className={cn(
                          "h-7 truncate px-1 text-right align-middle leading-none",
                          selected
                            ? "text-list-active-foreground/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {entry.kind === "dir" ? "" : formatBytes(entry.size)}
                      </td>
                      <td
                        className={cn(
                          "h-7 truncate pl-1 pr-2.5 text-right align-middle leading-none",
                          selected
                            ? "text-list-active-foreground/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatTime(entry.modified)}
                      </td>
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    onCloseAutoFocus={(event) => {
                      const pendingRename = pendingContextMenuRenameRef.current;
                      if (!pendingRename) return;
                      event.preventDefault();
                      pendingContextMenuRenameRef.current = null;
                      setRenameTarget(pendingRename);
                    }}
                  >
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
                      <ContextMenuItem
                        onSelect={() => {
                          pendingContextMenuRenameRef.current = {
                            tabId: tab.id,
                            cwd: tab.cwd,
                            path: entry.path,
                          };
                        }}
                      >
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

function InlineCreateRow({
  kind,
  onCreate,
  onCancel,
}: {
  kind: "file" | "folder";
  onCreate: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <tr className="h-7 bg-list-hover">
      <td className="h-7 pl-2.5 pr-1 align-middle">
        <span className="flex h-7 items-center gap-2">
          {kind === "folder" ? (
            <Folder className="size-4 shrink-0 text-warning" />
          ) : (
            <File className="size-4 shrink-0 text-muted-foreground" />
          )}
          <InlineNameInput
            initialValue=""
            ariaLabel={
              kind === "folder" ? t("sftp.newFolder") : t("sftp.newFile")
            }
            onSubmit={onCreate}
            onCancel={onCancel}
          />
        </span>
      </td>
      <td colSpan={2} />
    </tr>
  );
}

function InlineNameInput({
  initialValue,
  ariaLabel,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  ariaLabel: string;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = async () => {
    const name = value.trim();
    if (!name || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const succeeded = await onSubmit(name);
    if (!succeeded) {
      submittingRef.current = false;
      setSubmitting(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelledRef.current = true;
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={submitting}
      aria-label={ariaLabel}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (submittingRef.current || cancelledRef.current) return;
        if (inlineCreateBlurAction(value) === "create") void commit();
        else onCancel();
      }}
      className="h-5 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 text-xs text-foreground outline-none"
    />
  );
}

function FileDragGhost({ dragState }: { dragState: FileDragState }) {
  const previewEntries = dragState.entries.slice(0, 5);
  const remainingCount = dragState.entries.length - previewEntries.length;
  const rowGap = 4;
  const previewHeight =
    previewEntries.length * dragState.rect.height +
    Math.max(0, previewEntries.length - 1) * rowGap;
  const layout = layoutDragPreview({
    pointerX: dragState.clientX,
    pointerY: dragState.clientY,
    sourceWidth: dragState.rect.width,
    sourceHeight: previewHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] flex flex-col gap-1"
      style={layout}
    >
      {previewEntries.map((entry, index) => (
        <div
          key={entry.path}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-popover px-2 text-xs text-popover-foreground opacity-95 shadow-md"
          style={{ height: dragState.rect.height }}
        >
          <EntryIcon entry={entry} />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {index === previewEntries.length - 1 && remainingCount > 0 && (
            <span className="shrink-0 text-muted-foreground">
              +{remainingCount}
            </span>
          )}
          <span className="shrink-0 text-muted-foreground">
            {entry.kind === "dir" ? "" : formatBytes(entry.size)}
          </span>
        </div>
      ))}
    </div>
  );
}
