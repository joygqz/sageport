import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CircleX,
  FileText,
  FolderOpen,
  PlugZap,
  Plus,
  Save,
  SquareSplitHorizontal,
  SquareSplitVertical,
  SquareX,
  TerminalSquare,
  X,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  INTERACTIVE_FOCUS_CLASS,
} from "@/components/ui";
import { type ConfirmState } from "@/components/ui/confirm-dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useDragCursor } from "@/lib/pointerDrag";
import { IS_MACOS } from "@/lib/platform";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { focusFileEditor } from "@/features/sftp/editor-registry";
import { useSftpStore } from "@/features/sftp/store";
import { focusTerminal, getSession } from "@/features/terminal/sessions";
import { useOverlayStore } from "./overlays";
import { keybindingDisplayKeys } from "./keybinding-registry";
import { useKeybindingStore } from "./keybinding-store";
import { useLayoutStore } from "./layout";
import { getTabDropTarget } from "./tab-drag";
import {
  STATUS_DOT_CLASS,
  WORKBENCH_TAB_ACTIVE_CLASS,
  WORKBENCH_TAB_CLASS,
  WORKBENCH_TAB_CLOSE_CLASS,
  WORKBENCH_TAB_CLOSE_INACTIVE_CLASS,
  WORKBENCH_TAB_DROP_INDICATOR_CLASS,
  WORKBENCH_TAB_INACTIVE_CLASS,
  WORKBENCH_TAB_STRIP_GUTTER_CLASS,
} from "./tab-styles";
import {
  activePane,
  isFileDirty,
  tabTitle,
  useTabsStore,
  type EditorTab,
  type FileTab,
} from "./tabs";

const FileEditor = lazy(() =>
  import("@/features/sftp/FileEditor").then((m) => ({
    default: m.FileEditor,
  })),
);

const TerminalEditor = lazy(() =>
  import("@/features/terminal/TerminalEditor").then((module) => ({
    default: module.TerminalEditor,
  })),
);

const ConfirmDialog = lazy(() =>
  import("@/components/ui/confirm-dialog").then((module) => ({
    default: module.ConfirmDialog,
  })),
);

interface TabDragPointer {
  clientX: number;
  clientY: number;
  rect: DOMRect;
}

interface TabDragState extends TabDragPointer {
  id: string;
  indicatorX: number;
  indicatorTop: number;
  indicatorHeight: number;
}

export const EditorArea = memo(function EditorArea() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const close = useTabsStore((s) => s.close);
  const moveTab = useTabsStore((s) => s.moveTab);
  const saveFile = useTabsStore((s) => s.saveFile);
  const openPalette = useOverlayStore((s) => s.openPalette);
  const activeTab = tabs.find((tab) => tab.id === activeId);
  const activePaneId =
    activeTab?.kind === "terminal" ? activeTab.activePaneId : null;
  const stripRef = useRef<HTMLDivElement>(null);
  const preserveTabFocusRef = useRef(false);
  const suppressPaneFocusRef = useRef(false);
  const bulkCloseQueueRef = useRef<string[] | null>(null);
  const bulkClosePendingRef = useRef<string | null>(null);
  const [dragState, setDragState] = useState<TabDragState | null>(null);
  const isDragging = dragState !== null;
  const dropIndexRef = useRef<number | null>(null);
  const pendingCloseId = useTabsStore((s) => s.pendingCloseId);
  const clearPendingClose = useTabsStore((s) => s.clearPendingClose);
  const pendingWindowClose = useTabsStore((s) => s.pendingWindowClose);
  const clearPendingWindowClose = useTabsStore(
    (s) => s.clearPendingWindowClose,
  );
  const [savingBeforeWindowClose, setSavingBeforeWindowClose] = useState(false);
  const savingBeforeWindowCloseRef = useRef(false);

  const destroyWindow = async () => {
    try {
      await getCurrentWindow().destroy();
      return true;
    } catch (error) {
      toast.error(t("windowControls.actionError"), errorMessage(error));
      return false;
    }
  };

  useDragCursor(isDragging);

  const handleTabDragStart = (id: string, pointer: TabDragPointer) => {
    const sourceIndex = tabs.findIndex((tab) => tab.id === id);
    if (sourceIndex === -1) return;

    dropIndexRef.current = sourceIndex;
    setDragState({
      ...pointer,
      id,
      indicatorX: pointer.rect.left,
      indicatorTop: pointer.rect.top,
      indicatorHeight: pointer.rect.height,
    });
  };

  const handleTabDragMove = (id: string, clientX: number, clientY: number) => {
    const strip = stripRef.current;
    if (!strip) return;

    const bounds = strip.getBoundingClientRect();
    const edge = 28;
    if (clientX < bounds.left + edge) strip.scrollLeft -= 12;
    else if (clientX > bounds.right - edge) strip.scrollLeft += 12;

    const sourceIndex = tabs.findIndex((tab) => tab.id === id);
    if (sourceIndex === -1) return;

    const tabElements = tabs.map((tab) =>
      strip.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(tab.id)}"]`),
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
      current?.id === id
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

  const handleTabDragEnd = (id: string, didDrag: boolean) => {
    const dropIndex = dropIndexRef.current;
    dropIndexRef.current = null;
    setDragState(null);
    if (!didDrag) return;

    if (dropIndex !== null) moveTab(id, dropIndex);
  };

  const handleTabKeyboardMove = (id: string, direction: -1 | 1) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= tabs.length) return;
    moveTab(id, nextIndex);
    requestAnimationFrame(() => {
      stripRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
        ?.focus();
    });
  };

  const processBulkClose = () => {
    const queue = bulkCloseQueueRef.current;
    if (!queue) return;
    while (queue.length > 0) {
      const id = queue.shift()!;
      const tab = useTabsStore.getState().tabs.find((item) => item.id === id);
      if (!tab) continue;
      useTabsStore.getState().close(id);
      if (useTabsStore.getState().pendingCloseId === id) {
        bulkClosePendingRef.current = id;
        return;
      }
    }
    bulkCloseQueueRef.current = null;
    bulkClosePendingRef.current = null;
  };

  const closeOtherTabs = (id: string) => {
    bulkCloseQueueRef.current = tabs
      .filter((tab) => tab.id !== id)
      .map((tab) => tab.id);
    processBulkClose();
  };

  const closeAllTabs = () => {
    bulkCloseQueueRef.current = tabs.map((tab) => tab.id);
    processBulkClose();
  };

  useEffect(() => {
    if (pendingCloseId !== null) return;
    const queue = bulkCloseQueueRef.current;
    if (!queue || queue.length === 0) return;
    const pendingId = bulkClosePendingRef.current;
    bulkClosePendingRef.current = null;
    if (
      pendingId &&
      useTabsStore.getState().tabs.some((tab) => tab.id === pendingId)
    ) {
      bulkCloseQueueRef.current = null;
      return;
    }
    processBulkClose();
  }, [pendingCloseId, tabs]);

  const handleTabMenuOpen = (id: string) => {
    if (id === activeId) return;
    suppressPaneFocusRef.current = true;
    setActive(id);
  };

  const draggedTab = dragState
    ? tabs.find((tab) => tab.id === dragState.id)
    : undefined;

  const pendingTab = tabs.find(
    (tab): tab is FileTab => tab.id === pendingCloseId && tab.kind === "file",
  );
  const dirtyTabs = tabs.filter(
    (tab): tab is FileTab => tab.kind === "file" && isFileDirty(tab),
  );
  const saveAllBeforeWindowClose = async () => {
    if (savingBeforeWindowCloseRef.current) return false;
    savingBeforeWindowCloseRef.current = true;
    setSavingBeforeWindowClose(true);
    try {
      for (const tab of dirtyTabs) {
        if (!(await useTabsStore.getState().saveFile(tab.id))) {
          return false;
        }
      }
      const stillDirty = useTabsStore
        .getState()
        .tabs.some((tab) => tab.kind === "file" && isFileDirty(tab));
      if (stillDirty) return false;
      return destroyWindow();
    } finally {
      savingBeforeWindowCloseRef.current = false;
      setSavingBeforeWindowClose(false);
    }
  };
  const confirmState: ConfirmState | null = pendingWindowClose
    ? {
        title: t("editor.unsavedTitle"),
        description: t("editor.unsavedWindowDescription", {
          count: dirtyTabs.length,
        }),
        cancelLabel: t("common.cancel"),
        actions: [
          {
            label: t("editor.discardAll"),
            variant: "secondary",
            onSelect: destroyWindow,
          },
          {
            label: t("editor.saveAll"),
            loading: savingBeforeWindowClose,
            onSelect: saveAllBeforeWindowClose,
          },
        ],
      }
    : pendingTab
      ? {
          title: t("editor.unsavedTitle"),
          description: t("editor.unsavedDescription", {
            name: pendingTab.title,
          }),
          cancelLabel: t("common.cancel"),
          actions: [
            {
              label: t("editor.discard"),
              variant: "secondary",
              onSelect: () => close(pendingTab.id, { force: true }),
            },
            {
              label: t("common.save"),
              loading: pendingTab.saving,
              onSelect: async () => {
                if (!(await saveFile(pendingTab.id))) return false;
                close(pendingTab.id, { force: true });
                return true;
              },
            },
          ],
        }
      : null;

  useEffect(() => {
    if (!activeId) return;
    stripRef.current
      ?.querySelector(`[data-tab-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (preserveTabFocusRef.current || suppressPaneFocusRef.current) {
      preserveTabFocusRef.current = false;
      suppressPaneFocusRef.current = false;
      return;
    }
    if (activePaneId) focusTerminal(activePaneId);
    else focusFileEditor(activeId);
  }, [activeId, activePaneId]);

  useEffect(() => {
    const tabStrip = stripRef.current;
    if (!tabStrip) return;
    const handleWheel = (event: WheelEvent) => {
      if (
        tabStrip.scrollWidth <= tabStrip.clientWidth ||
        event.deltaX !== 0 ||
        event.deltaY === 0
      ) {
        return;
      }
      event.preventDefault();
      tabStrip.scrollLeft += event.deltaY;
    };
    tabStrip.addEventListener("wheel", handleWheel, { passive: false });
    return () => tabStrip.removeEventListener("wheel", handleWheel);
  }, [tabs.length]);

  if (tabs.length === 0) return <Watermark />;

  return (
    <Tabs
      value={activeId ?? ""}
      onValueChange={(id) => {
        preserveTabFocusRef.current =
          document.activeElement?.getAttribute("role") === "tab";
        setActive(id);
      }}
      asChild
    >
      <div className="isolate flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <div className="relative shrink-0 bg-surface">
          <div
            ref={stripRef}
            className={cn(
              "scrollbar-none flex h-[var(--workbench-bar-height)] gap-1 overflow-x-auto overflow-y-hidden",
              WORKBENCH_TAB_STRIP_GUTTER_CLASS,
            )}
          >
            <TabsList
              aria-label={t("editor.tabList")}
              className="flex h-full items-center gap-1"
            >
              {tabs.map((tab) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeId}
                  dragged={dragState?.id === tab.id}
                  onClose={() => close(tab.id)}
                  onCloseOthers={() => closeOtherTabs(tab.id)}
                  onCloseAll={closeAllTabs}
                  canCloseOthers={tabs.length > 1}
                  onMenuOpen={() => handleTabMenuOpen(tab.id)}
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
            <Tooltip content={t("editor.newSession")}>
              <button
                type="button"
                onClick={() => openPalette("quick")}
                className={cn(
                  "flex size-[var(--workbench-tab-height)] shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  INTERACTIVE_FOCUS_CLASS,
                )}
              >
                <Plus className="size-4" />
              </button>
            </Tooltip>
          </div>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border"
          />
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
                <TabDragGhost tab={draggedTab} dragState={dragState} />
              </>,
              document.body,
            )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} forceMount asChild>
              <div
                inert={tab.id !== activeId}
                className={cn(
                  "absolute inset-0",
                  tab.id !== activeId && "invisible opacity-0",
                )}
              >
                <ErrorBoundary>
                  <Suspense fallback={<EditorLoading />}>
                    {tab.kind === "terminal" ? (
                      <TerminalEditor tab={tab} active={tab.id === activeId} />
                    ) : (
                      <FileEditor tab={tab} />
                    )}
                  </Suspense>
                </ErrorBoundary>
              </div>
            </TabsContent>
          ))}
        </div>

        {(pendingWindowClose || pendingTab) && (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <ConfirmDialog
                state={confirmState}
                onClose={() => {
                  if (pendingWindowClose) clearPendingWindowClose();
                  else clearPendingClose();
                }}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </Tabs>
  );
});

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-terminal-background">
      <Spinner />
    </div>
  );
}

function TabItem({
  tab,
  active,
  dragged,
  onClose,
  onCloseOthers,
  onCloseAll,
  canCloseOthers,
  onMenuOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
  onKeyboardMove,
}: {
  tab: EditorTab;
  active: boolean;
  dragged: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  canCloseOthers: boolean;
  onMenuOpen: () => void;
  onDragStart: (pointer: TabDragPointer) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (didDrag: boolean) => void;
  onKeyboardMove: (direction: -1 | 1) => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const openLocalTerminal = useTabsStore((s) => s.openLocalTerminal);
  const openAdhocTerminal = useTabsStore((s) => s.openAdhocTerminal);
  const reconnectTerminal = useTabsStore((s) => s.reconnectTerminal);
  const splitPane = useTabsStore((s) => s.splitPane);
  const saveFile = useTabsStore((s) => s.saveFile);
  const addRemoteFileTab = useSftpStore((s) => s.addRemoteTab);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const title = tabTitle(tab);
  const dirty = tab.kind === "file" && isFileDirty(tab);
  const pane = tab.kind === "terminal" ? activePane(tab) : null;
  const canReconnect =
    pane !== null &&
    pane.target !== "local" &&
    (pane.status === "closed" || pane.status === "error");

  const reopen = pane
    ? pane.target === "local"
      ? () => openLocalTerminal()
      : pane.target === "ssh-adhoc" && pane.adhoc
        ? () => openAdhocTerminal(pane.adhoc!)
        : () => openTerminal({ id: pane.hostId, label: pane.title })
    : undefined;

  const openFiles =
    pane?.target === "ssh"
      ? () => {
          const directory = getSession(pane.id)?.currentDirectory();
          setPanelVisible(true);
          const opened = addRemoteFileTab(
            "right",
            { id: pane.hostId, label: pane.title },
            directory,
          );
          if (opened && !directory) {
            toast.info(t("sftp.currentDirectoryUnavailable"));
          }
        }
      : undefined;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (
      e.button !== 0 ||
      (e.target as HTMLElement).closest("[data-tab-close]")
    ) {
      return;
    }
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
      onDragStart({
        clientX: e.clientX,
        clientY: e.clientY,
        rect: e.currentTarget.getBoundingClientRect(),
      });
    }

    e.preventDefault();
    onDragMove(e.clientX, e.clientY);
  };

  const finishPointerDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) e.preventDefault();
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onDragEnd(drag.active && !cancelled);
  };

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) onMenuOpen();
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          data-tab-id={tab.id}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={(event) => finishPointerDrag(event, true)}
          onLostPointerCapture={(event) => finishPointerDrag(event, true)}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest("[data-tab-close]"))
              return;
            reopen?.();
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onClose();
            }
          }}
          className={cn(
            WORKBENCH_TAB_CLASS,
            "h-[var(--workbench-tab-height)] w-fit min-w-24 max-w-52 gap-2 px-3",
            dragged && "opacity-50",
            active
              ? cn(WORKBENCH_TAB_ACTIVE_CLASS, "z-10")
              : WORKBENCH_TAB_INACTIVE_CLASS,
          )}
        >
          <TabsTrigger
            value={tab.id}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-start gap-2 self-stretch rounded-md text-left",
              INTERACTIVE_FOCUS_CLASS,
            )}
            onKeyDown={(e) => {
              if (
                !e.altKey ||
                (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
              ) {
                return;
              }
              e.preventDefault();
              onKeyboardMove(e.key === "ArrowLeft" ? -1 : 1);
            }}
          >
            {tab.kind === "terminal" && pane ? (
              <span className="relative flex shrink-0 items-center justify-center">
                <TerminalSquare className="size-3.5" />
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2",
                    "ring-[var(--tab-background)]",
                    STATUS_DOT_CLASS[pane.status],
                  )}
                />
              </span>
            ) : (
              <FileText className="size-3.5 shrink-0" />
            )}

            <span className="min-w-0 max-w-36 truncate text-left">{title}</span>

            {tab.kind === "terminal" && tab.panes.length > 1 && (
              <span className="shrink-0 rounded-sm bg-accent px-1 font-mono text-[10px] leading-4 text-muted-foreground">
                {tab.panes.length}
              </span>
            )}

            {dirty && (
              <span
                aria-label={t("editor.unsavedIndicator")}
                className="size-1.5 shrink-0 rounded-full bg-foreground/70"
              />
            )}
          </TabsTrigger>

          <button
            data-tab-close
            type="button"
            tabIndex={active ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label={t("editor.closeTab")}
            className={cn(
              WORKBENCH_TAB_CLOSE_CLASS,
              "size-5",
              !active && WORKBENCH_TAB_CLOSE_INACTIVE_CLASS,
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {tab.kind === "terminal" && pane && (
          <>
            {canReconnect && (
              <ContextMenuItem onSelect={() => reconnectTerminal(pane.id)}>
                <PlugZap /> {t("terminal.reconnect")}
              </ContextMenuItem>
            )}
            {openFiles && (
              <ContextMenuItem onSelect={openFiles}>
                <FolderOpen /> {t("sftp.openFromTerminal")}
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => reopen?.()}>
              <Plus /> {t("editor.newSession")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => splitPane(pane.id, "right")}>
              <SquareSplitHorizontal /> {t("commands.terminal.splitRight")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => splitPane(pane.id, "down")}>
              <SquareSplitVertical /> {t("commands.terminal.splitDown")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        {tab.kind === "file" && (
          <>
            <ContextMenuItem
              disabled={!dirty || tab.saving}
              onSelect={() => void saveFile(tab.id)}
            >
              <Save /> {t("common.save")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={onClose}>
          <X /> {t("editor.closeTab")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canCloseOthers} onSelect={onCloseOthers}>
          <CircleX /> {t("editor.closeOtherTabs")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>
          <SquareX /> {t("editor.closeAllTabs")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TabDragGhost({
  tab,
  dragState,
}: {
  tab: EditorTab;
  dragState: TabDragState;
}) {
  const title = tabTitle(tab);
  const dirty = tab.kind === "file" && isFileDirty(tab);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] flex items-center gap-2 rounded-md border border-border-strong bg-list-active px-2.5 text-xs text-list-active-foreground"
      style={{
        left: dragState.clientX,
        top: dragState.clientY,
        width: dragState.rect.width,
        height: dragState.rect.height,
      }}
    >
      {tab.kind === "terminal" ? (
        <span className="relative flex shrink-0 items-center justify-center">
          <TerminalSquare className="size-3.5" />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-list-active",
              STATUS_DOT_CLASS[activePane(tab).status],
            )}
          />
        </span>
      ) : (
        <FileText className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {dirty ? (
        <span className="size-2 shrink-0 rounded-full bg-foreground" />
      ) : (
        <X className="size-3.5 shrink-0 opacity-60" />
      )}
    </div>
  );
}

function Watermark() {
  const { t } = useI18n();
  const keybindingOverrides = useKeybindingStore((state) => state.overrides);
  const hints = (
    [
      ["watermark.quickConnect", "palette.quick"],
      ["watermark.commands", "palette.commands"],
      ["watermark.newHost", "host.new"],
      ["watermark.newLocal", "terminal.newLocal"],
      ["watermark.settings", "settings.open"],
    ] as const
  ).flatMap(([labelKey, id]) => {
    const keys = keybindingDisplayKeys(id, keybindingOverrides, IS_MACOS);
    return keys ? [{ label: t(labelKey), keys }] : [];
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      <div className="m-auto grid min-w-max grid-cols-[auto_auto] items-center gap-x-4 gap-y-2.5 p-3">
        {hints.map((hint) => (
          <Fragment key={hint.label}>
            <span className="text-right text-sm text-muted-foreground">
              {hint.label}
            </span>
            <Kbd keys={hint.keys} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
