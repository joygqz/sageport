import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FilePlus,
  FolderPlus,
  HardDrive,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useDragCursor } from "@/lib/pointerDrag";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/models";
import { useHosts } from "@/features/hosts/api";
import { getTabDropTarget } from "@/workbench/tab-drag";
import {
  STATUS_DOT_CLASS,
  WORKBENCH_COMPACT_TAB_STRIP_GUTTER_CLASS,
  WORKBENCH_TAB_ACTIVE_CLASS,
  WORKBENCH_TAB_CLASS,
  WORKBENCH_TAB_CLOSE_CLASS,
  WORKBENCH_TAB_CLOSE_INACTIVE_CLASS,
  WORKBENCH_TAB_DROP_INDICATOR_CLASS,
  WORKBENCH_TAB_INACTIVE_CLASS,
} from "@/workbench/tab-styles";
import { FileList } from "./FileList";
import { BookmarkMenu } from "./BookmarkMenu";
import { PermissionsDialog } from "./PermissionsDialog";
import {
  joinPath,
  isValidEntryName,
  parentPath,
  useSftpStore,
  type PaneSide,
  type SftpTab,
} from "./store";

interface SftpTabDragPointer {
  clientX: number;
  clientY: number;
  rect: DOMRect;
}

interface SftpTabDragState extends SftpTabDragPointer {
  id: string;
  indicatorX: number;
  indicatorTop: number;
  indicatorHeight: number;
}

export function FilePane({ side }: { side: PaneSide }) {
  const { t } = useI18n();
  const pane = useSftpStore((s) => s.panes[side]);
  const addLocalTab = useSftpStore((s) => s.addLocalTab);
  const addRemoteTab = useSftpStore((s) => s.addRemoteTab);
  const closeTab = useSftpStore((s) => s.closeTab);
  const moveTab = useSftpStore((s) => s.moveTab);
  const setActive = useSftpStore((s) => s.setActive);
  const navigate = useSftpStore((s) => s.navigate);
  const navigateToHistory = useSftpStore((s) => s.navigateToHistory);
  const restoreLoadedPath = useSftpStore((s) => s.restoreLoadedPath);
  const refresh = useSftpStore((s) => s.refresh);
  const applyStatus = useSftpStore((s) => s.applyStatus);
  const { data: hosts = [] } = useHosts();

  const tabStripRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<SftpTabDragState | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const [creation, setCreation] = useState<{
    kind: "file" | "folder";
    tabId: string;
    cwd: string;
  } | null>(null);
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
  const creating =
    creation &&
    active &&
    creation.tabId === active.id &&
    creation.cwd === active.cwd
      ? creation.kind
      : null;
  const draggedTab = dragState
    ? pane.tabs.find((tab) => tab.id === dragState.id)
    : undefined;

  useDragCursor(dragState !== null);

  const handleTabDragStart = (tabId: string, pointer: SftpTabDragPointer) => {
    const sourceIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (sourceIndex === -1) return;

    dropIndexRef.current = sourceIndex;
    setDragState({
      ...pointer,
      id: tabId,
      indicatorX: pointer.rect.left,
      indicatorTop: pointer.rect.top,
      indicatorHeight: pointer.rect.height,
    });
  };

  const handleTabDragMove = (
    tabId: string,
    clientX: number,
    clientY: number,
  ) => {
    const strip = tabStripRef.current;
    if (!strip) return;

    const bounds = strip.getBoundingClientRect();
    const edge = 24;
    if (clientX < bounds.left + edge) strip.scrollLeft -= 12;
    else if (clientX > bounds.right - edge) strip.scrollLeft += 12;

    const sourceIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (sourceIndex === -1) return;

    const tabElements = pane.tabs.map((tab) =>
      strip.querySelector<HTMLElement>(
        `[data-sftp-tab-id="${CSS.escape(tab.id)}"]`,
      ),
    );
    const { insertIndex, indicatorX } = getTabDropTarget({
      pointerX: clientX,
      stripRect: bounds,
      tabRects: tabElements.map(
        (element) => element?.getBoundingClientRect() ?? null,
      ),
    });
    const markerRect =
      tabElements
        .find((element) => element !== null)
        ?.getBoundingClientRect() ?? bounds;

    const nextIndex = sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
    dropIndexRef.current = nextIndex;
    setDragState((current) =>
      current?.id === tabId
        ? {
            ...current,
            clientX,
            clientY,
            indicatorX,
            indicatorTop: markerRect.top,
            indicatorHeight: markerRect.height,
          }
        : current,
    );
  };

  const handleTabDragEnd = (tabId: string, didDrag: boolean) => {
    const dropIndex = dropIndexRef.current;
    dropIndexRef.current = null;
    setDragState(null);
    if (!didDrag) return;

    if (dropIndex !== null) moveTab(side, tabId, dropIndex);
  };

  const handleTabKeyboardMove = (tabId: string, direction: -1 | 1) => {
    const index = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= pane.tabs.length) return;
    moveTab(side, tabId, nextIndex);
    requestAnimationFrame(() => {
      tabStripRef.current
        ?.querySelector<HTMLElement>(
          `[data-sftp-tab-id="${CSS.escape(tabId)}"]`,
        )
        ?.focus();
    });
  };

  const onCreate = async (
    tab: SftpTab,
    kind: "file" | "folder",
    name: string,
  ) => {
    if (!isValidEntryName(name)) {
      toast.error(t("sftp.invalidName"));
      return false;
    }
    try {
      const path = joinPath(tab.cwd, name);
      if (kind === "folder") {
        await ipc.sftp.mkdir(tab.connectionId, path);
      } else {
        await ipc.sftp.writeText(tab.connectionId, path, "");
      }
      setCreation(null);
      await refresh(side, tab.id);
      return true;
    } catch (err) {
      if (tab.connectionId && errorCode(err) === "network") {
        applyStatus(tab.connectionId, "error", errorMessage(err), "network");
      }
      toast.error(
        t(kind === "folder" ? "sftp.mkdirError" : "sftp.createFileError"),
        errorMessage(err),
      );
      return false;
    }
  };

  const onRename = async (tab: SftpTab, entry: FileEntry, name: string) => {
    if (name === entry.name) return true;
    if (!isValidEntryName(name)) {
      toast.error(t("sftp.invalidName"));
      return false;
    }
    try {
      await ipc.sftp.rename(
        tab.connectionId,
        entry.path,
        joinPath(parentPath(entry.path), name),
      );
      await refresh(side, tab.id);
      return true;
    } catch (err) {
      if (tab.connectionId && errorCode(err) === "network") {
        applyStatus(tab.connectionId, "error", errorMessage(err), "network");
      }
      toast.error(t("sftp.renameError"), errorMessage(err));
      return false;
    }
  };

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
      if (tab.connectionId && errorCode(err) === "network") {
        applyStatus(tab.connectionId, "error", errorMessage(err), "network");
      }
      toast.error(t("sftp.deleteError"), errorMessage(err));
    } finally {
      if (changed) await refresh(side, tab.id);
    }
  };

  const confirmDelete = (tab: SftpTab, entries: FileEntry[]) => {
    const [entry] = entries;
    if (!entry) return;
    setConfirmState({
      title:
        entries.length === 1
          ? t("sftp.deleteOneTitle")
          : t("sftp.deleteManyTitle", { count: entries.length }),
      description:
        entries.length === 1
          ? t("common.deleteConfirm", { name: entry.name })
          : t("sftp.deleteManyConfirm", { count: entries.length }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label:
            entries.length === 1
              ? t("sftp.deleteOneAction")
              : t("sftp.deleteManyAction"),
          variant: "destructive",
          onSelect: () => void onDelete(tab, entries),
        },
      ],
    });
  };

  return (
    <Tabs
      value={pane.activeTabId ?? ""}
      onValueChange={(id) => setActive(side, id)}
      asChild
    >
      <div
        data-file-pane-side={side}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div
          ref={tabStripRef}
          onWheel={(e) => {
            const el = tabStripRef.current;
            if (!el || el.scrollWidth <= el.clientWidth || e.deltaX !== 0) {
              return;
            }
            el.scrollLeft += e.deltaY;
          }}
          className={cn(
            "scrollbar-none flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface",
            WORKBENCH_COMPACT_TAB_STRIP_GUTTER_CLASS,
          )}
        >
          <TabsList
            aria-label={t("sftp.panelTitle")}
            className="flex h-full items-center gap-1"
          >
            {pane.tabs.map((tab) => (
              <SftpTabItem
                key={tab.id}
                tab={tab}
                active={tab.id === pane.activeTabId}
                dragged={dragState?.id === tab.id}
                label={tab.kind === "local" ? t("sftp.local") : tab.title}
                onClose={() => closeTab(side, tab.id)}
                onReopen={() => {
                  if (tab.kind === "local") {
                    void addLocalTab(side);
                    return;
                  }
                  const host = hosts.find((h) => h.id === tab.hostId);
                  if (host) addRemoteTab(side, host);
                }}
                onDragStart={(pointer) => handleTabDragStart(tab.id, pointer)}
                onDragMove={(clientX, clientY) =>
                  handleTabDragMove(tab.id, clientX, clientY)
                }
                onDragEnd={(didDrag) => handleTabDragEnd(tab.id, didDrag)}
                onKeyboardMove={(direction) =>
                  handleTabKeyboardMove(tab.id, direction)
                }
              />
            ))}
          </TabsList>

          <DropdownMenu>
            <Tooltip content={t("sftp.newTab")}>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-6 shrink-0">
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent
              align="start"
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
        </div>

        {dragState &&
          draggedTab &&
          createPortal(
            <>
              <span
                aria-hidden="true"
                className={WORKBENCH_TAB_DROP_INDICATOR_CLASS}
                style={{
                  left: Math.round(dragState.indicatorX - 1),
                  top: dragState.indicatorTop,
                  height: dragState.indicatorHeight,
                }}
              />
              <SftpTabDragGhost tab={draggedTab} dragState={dragState} />
            </>,
            document.body,
          )}

        {active ? (
          <TabsContent
            value={active.id}
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <div className="flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-1 overflow-hidden border-b border-border bg-surface px-1.5">
              <Tooltip content={t("sftp.back")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={
                    !activeReady ||
                    (!active.navigationPath && active.historyIndex <= 0)
                  }
                  onClick={() => {
                    if (active.navigationPath) {
                      restoreLoadedPath(side, active.id);
                      return;
                    }
                    void navigateToHistory(
                      side,
                      active.id,
                      active.historyIndex - 1,
                    );
                  }}
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
                    !!active.navigationPath ||
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
              <Tooltip content={t("sftp.parent")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={
                    !activeReady || parentPath(active.cwd) === active.cwd
                  }
                  onClick={() =>
                    void navigate(side, active.id, parentPath(active.cwd))
                  }
                >
                  <ChevronUp className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={t("sftp.newFolder")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={!activeReady}
                  onClick={() =>
                    setCreation({
                      kind: "folder",
                      tabId: active.id,
                      cwd: active.cwd,
                    })
                  }
                >
                  <FolderPlus className="size-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content={t("sftp.newFile")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={!activeReady}
                  onClick={() =>
                    setCreation({
                      kind: "file",
                      tabId: active.id,
                      cwd: active.cwd,
                    })
                  }
                >
                  <FilePlus className="size-3.5" />
                </Button>
              </Tooltip>
              <BookmarkMenu side={side} tab={active} />
              <PathBar
                key={active.navigationPath ?? active.cwd}
                side={side}
                tab={active}
              />
            </div>

            <FileList
              side={side}
              tab={active}
              creating={creating}
              onCreate={(name) => onCreate(active, creating!, name)}
              onCancelCreate={() => setCreation(null)}
              onRename={(entry, name) => onRename(active, entry, name)}
              onDelete={(entries) => confirmDelete(active, entries)}
              onPermissions={(entry) => setPermTarget({ tab: active, entry })}
            />
          </TabsContent>
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
    </Tabs>
  );
}

function SftpTabItem({
  tab,
  active,
  dragged,
  label,
  onClose,
  onReopen,
  onDragStart,
  onDragMove,
  onDragEnd,
  onKeyboardMove,
}: {
  tab: SftpTab;
  active: boolean;
  dragged: boolean;
  label: string;
  onClose: () => void;
  onReopen: () => void;
  onDragStart: (pointer: SftpTabDragPointer) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (didDrag: boolean) => void;
  onKeyboardMove: (direction: -1 | 1) => void;
}) {
  const { t } = useI18n();
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("[data-tab-close]")
    ) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (distance < 5) return;
      drag.active = true;
      onDragStart({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: event.currentTarget.getBoundingClientRect(),
      });
    }

    event.preventDefault();
    onDragMove(event.clientX, event.clientY);
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.active) event.preventDefault();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDragEnd(drag.active);
  };

  return (
    <div
      data-sftp-tab-id={tab.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-tab-close]")) return;
        onReopen();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) onClose();
      }}
      className={cn(
        WORKBENCH_TAB_CLASS,
        "h-full w-fit min-w-24 max-w-44 gap-1.5 px-2",
        dragged && "opacity-50",
        active
          ? cn(WORKBENCH_TAB_ACTIVE_CLASS, "z-10")
          : WORKBENCH_TAB_INACTIVE_CLASS,
      )}
    >
      <TabsTrigger
        value={tab.id}
        className="flex min-w-0 flex-1 items-center justify-start gap-1.5 self-stretch rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
        onKeyDown={(event) => {
          if (
            event.altKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            event.preventDefault();
            onKeyboardMove(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          {tab.kind === "local" ? (
            <HardDrive className="size-3" />
          ) : (
            <Server className="size-3" />
          )}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-[var(--tab-background)]",
              STATUS_DOT_CLASS[tab.status],
            )}
          />
        </span>
        <span className="min-w-0 max-w-28 truncate text-left">{label}</span>
      </TabsTrigger>
      <button
        data-tab-close
        type="button"
        tabIndex={active ? 0 : -1}
        aria-label={t("editor.closeTab")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          WORKBENCH_TAB_CLOSE_CLASS,
          "size-4",
          !active && WORKBENCH_TAB_CLOSE_INACTIVE_CLASS,
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function SftpTabDragGhost({
  tab,
  dragState,
}: {
  tab: SftpTab;
  dragState: SftpTabDragState;
}) {
  const { t } = useI18n();
  const label = tab.kind === "local" ? t("sftp.local") : tab.title;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] flex items-center gap-1.5 rounded-lg border border-border bg-list-active px-2 text-xs text-list-active-foreground opacity-90 shadow-md"
      style={{
        left: dragState.clientX,
        top: dragState.clientY,
        width: dragState.rect.width,
        height: dragState.rect.height,
      }}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        {tab.kind === "local" ? (
          <HardDrive className="size-3" />
        ) : (
          <Server className="size-3" />
        )}
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-list-active",
            STATUS_DOT_CLASS[tab.status],
          )}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <X className="size-3 shrink-0 opacity-60" />
    </div>
  );
}

function PathBar({ side, tab }: { side: PaneSide; tab: SftpTab }) {
  const { t } = useI18n();
  const navigate = useSftpStore((s) => s.navigate);
  const restoreLoadedPath = useSftpStore((s) => s.restoreLoadedPath);
  const displayedPath = tab.navigationPath ?? tab.cwd;
  const [value, setValue] = useState(displayedPath);
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
      title={displayedPath}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const next = value.trim();
          if (next && next !== tab.cwd) {
            void navigate(side, tab.id, next);
          }
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          if (tab.navigationPath) restoreLoadedPath(side, tab.id);
          setValue(tab.cwd);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        setValue(displayedPath);
        scrollToEnd();
      }}
      className="ml-1 h-7 min-w-0 flex-1 rounded-lg border-transparent bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:bg-surface/50 focus-visible:bg-surface focus-visible:text-foreground"
    />
  );
}
