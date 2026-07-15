import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileText, Plus, TerminalSquare, X } from "lucide-react";

import {
  ConfirmDialog,
  Kbd,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { useDragCursor } from "@/lib/pointerDrag";
import { cn } from "@/lib/utils";
import { focusFileEditor } from "@/features/sftp/editor-registry";
import { focusTerminal } from "@/features/terminal/sessions";
import { useOverlayStore } from "./overlays";
import { getTabDropTarget } from "./tab-drag";
import {
  STATUS_DOT_CLASS,
  WORKBENCH_TAB_ACTIVE_CLASS,
  WORKBENCH_TAB_CLASS,
  WORKBENCH_TAB_CLOSE_CLASS,
  WORKBENCH_TAB_DROP_INDICATOR_CLASS,
  WORKBENCH_TAB_INACTIVE_CLASS,
  WORKBENCH_TAB_STRIP_GUTTER_CLASS,
} from "./tab-styles";
import {
  isFileDirty,
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

export function EditorArea() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const close = useTabsStore((s) => s.close);
  const moveTab = useTabsStore((s) => s.moveTab);
  const saveFile = useTabsStore((s) => s.saveFile);
  const openPalette = useOverlayStore((s) => s.openPalette);
  const stripRef = useRef<HTMLDivElement>(null);
  const preserveTabFocusRef = useRef(false);
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

  const draggedTab = dragState
    ? tabs.find((tab) => tab.id === dragState.id)
    : undefined;

  const pendingTab = tabs.find(
    (tab): tab is FileTab => tab.id === pendingCloseId && tab.kind === "file",
  );
  const dirtyTabs = tabs.filter(
    (tab): tab is FileTab => tab.kind === "file" && isFileDirty(tab),
  );
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
            onSelect: async () => {
              await getCurrentWindow().destroy();
            },
          },
          {
            label: t("editor.saveAll"),
            loading: savingBeforeWindowClose,
            onSelect: async () => {
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
                await getCurrentWindow().destroy();
                return true;
              } finally {
                setSavingBeforeWindowClose(false);
              }
            },
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
    if (preserveTabFocusRef.current) {
      preserveTabFocusRef.current = false;
      return;
    }
    focusTerminal(activeId);
    focusFileEditor(activeId);
  }, [activeId]);

  if (tabs.length === 0) return <Watermark />;

  return (
    <Tabs
      value={activeId ?? undefined}
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
            onWheel={(e) => {
              const el = stripRef.current;
              if (!el || el.scrollWidth <= el.clientWidth || e.deltaX !== 0) {
                return;
              }
              el.scrollLeft += e.deltaY;
            }}
            className={cn(
              "scrollbar-none flex h-[var(--workbench-bar-height)] overflow-x-auto overflow-y-hidden",
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
                className="ml-1 flex size-[var(--toolbar-control-size)] shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
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
                <Suspense fallback={<EditorLoading />}>
                  {tab.kind === "terminal" ? (
                    <TerminalEditor tab={tab} active={tab.id === activeId} />
                  ) : (
                    <FileEditor tab={tab} />
                  )}
                </Suspense>
              </div>
            </TabsContent>
          ))}
        </div>

        <ConfirmDialog
          state={confirmState}
          onClose={() => {
            if (pendingWindowClose) clearPendingWindowClose();
            else clearPendingClose();
          }}
        />
      </div>
    </Tabs>
  );
}

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
  onDragStart,
  onDragMove,
  onDragEnd,
  onKeyboardMove,
}: {
  tab: EditorTab;
  active: boolean;
  dragged: boolean;
  onClose: () => void;
  onDragStart: (pointer: TabDragPointer) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (didDrag: boolean) => void;
  onKeyboardMove: (direction: -1 | 1) => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const openLocalTerminal = useTabsStore((s) => s.openLocalTerminal);
  const openAdhocTerminal = useTabsStore((s) => s.openAdhocTerminal);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const title = tab.title;
  const dirty = tab.kind === "file" && isFileDirty(tab);

  const reopen =
    tab.kind === "terminal"
      ? tab.target === "local"
        ? () => openLocalTerminal()
        : tab.target === "ssh-adhoc" && tab.adhoc
          ? () => openAdhocTerminal(tab.adhoc!)
          : () => openTerminal({ id: tab.hostId, label: tab.title })
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

  const finishPointerDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active) e.preventDefault();
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onDragEnd(drag.active);
  };

  return (
    <div
      data-tab-id={tab.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-tab-close]")) return;
        reopen?.();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      className={cn(
        WORKBENCH_TAB_CLASS,
        "h-full w-fit min-w-24 max-w-52 gap-2 px-3",
        dragged && "opacity-50",
        active
          ? cn(WORKBENCH_TAB_ACTIVE_CLASS, "z-10")
          : WORKBENCH_TAB_INACTIVE_CLASS,
      )}
    >
      <TabsTrigger
        value={tab.id}
        className="flex min-w-0 flex-1 items-center justify-start gap-2 self-stretch rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35"
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) {
            return;
          }
          e.preventDefault();
          onKeyboardMove(e.key === "ArrowLeft" ? -1 : 1);
        }}
      >
        {tab.kind === "terminal" ? (
          <span className="relative flex shrink-0 items-center justify-center">
            <TerminalSquare className="size-3.5" />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2",
                "ring-[var(--tab-background)]",
                STATUS_DOT_CLASS[tab.status],
              )}
            />
          </span>
        ) : (
          <FileText className="size-3.5 shrink-0" />
        )}

        <span className="min-w-0 max-w-36 truncate text-left">{title}</span>

        {dirty && (
          <span
            aria-label={t("editor.unsavedTitle")}
            className="size-1.5 shrink-0 rounded-full bg-foreground/70"
          />
        )}
      </TabsTrigger>

      <button
        data-tab-close
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t("editor.closeTab")}
        className={cn(
          WORKBENCH_TAB_CLOSE_CLASS,
          "size-5",
          !active &&
            "pointer-events-none -ml-2 w-0 opacity-0 group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-5 group-hover:opacity-70",
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function TabDragGhost({
  tab,
  dragState,
}: {
  tab: EditorTab;
  dragState: TabDragState;
}) {
  const title = tab.title;
  const dirty = tab.kind === "file" && isFileDirty(tab);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] flex items-center gap-2 rounded-lg border border-border bg-list-active px-2.5 text-xs text-list-active-foreground opacity-90 shadow-md"
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
              STATUS_DOT_CLASS[tab.status],
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
  const hints: { label: string; keys: string[] }[] = [
    { label: t("watermark.quickConnect"), keys: ["mod", "P"] },
    { label: t("watermark.commands"), keys: ["mod", "shift", "P"] },
    { label: t("watermark.newHost"), keys: ["mod", "N"] },
    { label: t("watermark.newLocal"), keys: ["mod", "shift", "T"] },
    { label: t("watermark.settings"), keys: ["mod", ","] },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background [background-image:radial-gradient(circle_at_50%_42%,color-mix(in_oklch,var(--color-primary)_7%,transparent),transparent_32%)]">
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
