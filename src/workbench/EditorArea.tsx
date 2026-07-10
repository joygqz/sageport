import { Fragment, lazy, Suspense, useEffect, useRef } from "react";
import { FileText, Plus, Settings, TerminalSquare, X } from "lucide-react";

import {
  ConfirmDialog,
  Kbd,
  Spinner,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { focusFileEditor } from "@/features/sftp/editor-registry";
import { TerminalEditor } from "@/features/terminal/TerminalEditor";
import { focusTerminal } from "@/features/terminal/registry";
import { useOverlayStore } from "./overlays";
import {
  isFileDirty,
  useTabsStore,
  type EditorTab,
  type FileTab,
  type TerminalStatus,
} from "./tabs";

const FileEditor = lazy(() =>
  import("@/features/sftp/FileEditor").then((m) => ({
    default: m.FileEditor,
  })),
);

const statusDot: Record<TerminalStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export function EditorArea() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const close = useTabsStore((s) => s.close);
  const saveFile = useTabsStore((s) => s.saveFile);
  const openPalette = useOverlayStore((s) => s.openPalette);
  const stripRef = useRef<HTMLDivElement>(null);
  const pendingCloseId = useTabsStore((s) => s.pendingCloseId);
  const clearPendingClose = useTabsStore((s) => s.clearPendingClose);

  const pendingTab = tabs.find(
    (tab): tab is FileTab => tab.id === pendingCloseId && tab.kind === "file",
  );
  const confirmState: ConfirmState | null = pendingTab
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
              if (await saveFile(pendingTab.id))
                close(pendingTab.id, { force: true });
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
    focusTerminal(activeId);
    focusFileEditor(activeId);
  }, [activeId]);

  if (tabs.length === 0) return <Watermark />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div
        ref={stripRef}

        onWheel={(e) => {
          const el = stripRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          el.scrollLeft += e.deltaX + e.deltaY;
        }}
        className="scrollbar-none flex h-9 shrink-0 items-end overflow-x-auto border-b border-border bg-surface"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onSelect={() => setActive(tab.id)}
            onClose={() => close(tab.id)}
          />
        ))}
        <Tooltip content={t("editor.newSession")}>
          <button
            onClick={() => openPalette("quick")}
            className="mx-1 flex size-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="size-4" />
          </button>
        </Tooltip>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}

            className={cn(
              "absolute inset-0",
              tab.id === activeId
                ? "visible"
                : "invisible [&_.xterm_.scrollbar]:hidden",
            )}
          >
            {tab.kind === "terminal" ? (
              <TerminalEditor tab={tab} active={tab.id === activeId} />
            ) : tab.kind === "file" ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center bg-background">
                    <Spinner />
                  </div>
                }
              >
                <FileEditor tab={tab} />
              </Suspense>
            ) : (
              <SettingsPage section={tab.section} />
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog state={confirmState} onClose={clearPendingClose} />
    </div>
  );
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: EditorTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const openLocalTerminal = useTabsStore((s) => s.openLocalTerminal);

  const title = tab.kind === "settings" ? t("settings.title") : tab.title;
  const dirty = tab.kind === "file" && isFileDirty(tab);

  const reopen =
    tab.kind === "terminal"
      ? tab.target === "local"
        ? () => openLocalTerminal()
        : () => openTerminal({ id: tab.hostId, label: tab.title })
      : undefined;

  return (
    <div
      data-tab-id={tab.id}
      onClick={onSelect}
      onDoubleClick={reopen}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      className={cn(
        "group relative flex h-full min-w-32 max-w-52 cursor-pointer items-center gap-2 border-r border-border px-3 text-xs",
        active
          ? "bg-background text-foreground"
          : "bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}

      {tab.kind === "terminal" ? (
        <span className="relative flex shrink-0 items-center justify-center">
          <TerminalSquare className="size-3.5" />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full ring-2",
              active ? "ring-background" : "ring-surface",
              statusDot[tab.status],
            )}
          />
        </span>
      ) : tab.kind === "file" ? (
        <FileText className="size-3.5 shrink-0" />
      ) : (
        <Settings className="size-3.5 shrink-0" />
      )}

      <span className="min-w-0 flex-1 truncate">{title}</span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={t("editor.closeTab")}
        className={cn(
          "group/close flex size-4.5 shrink-0 items-center justify-center rounded transition-opacity hover:bg-accent",
          dirty
            ? "opacity-100"
            : active
              ? "opacity-60 hover:opacity-100"
              : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100",
        )}
      >
        {dirty && (
          <span className="size-2 rounded-full bg-foreground group-hover/close:hidden" />
        )}
        <X
          className={cn("size-3.5", dirty && "hidden group-hover/close:block")}
        />
      </button>
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
