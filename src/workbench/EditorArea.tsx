import { Plus, Settings, TerminalSquare, X } from "lucide-react";

import { Kbd, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TerminalEditor } from "@/features/terminal/TerminalEditor";
import { useOverlayStore } from "./overlays";
import { useTabsStore, type EditorTab, type TerminalStatus } from "./tabs";

const statusDot: Record<TerminalStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

/**
 * The main editor area: one tab strip over a content region. Terminal tabs
 * stay mounted while hidden so their scrollback and connection survive tab
 * switches; the settings tab is a full page, not a dialog.
 */
export function EditorArea() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const setActive = useTabsStore((s) => s.setActive);
  const close = useTabsStore((s) => s.close);
  const openPalette = useOverlayStore((s) => s.openPalette);

  if (tabs.length === 0) return <Watermark />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border bg-surface">
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

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0",
              tab.id === activeId ? "block" : "hidden",
            )}
          >
            {tab.kind === "terminal" ? (
              <TerminalEditor tab={tab} />
            ) : (
              <SettingsPage section={tab.section} />
            )}
          </div>
        ))}
      </div>
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

  const title = tab.kind === "settings" ? t("settings.title") : tab.title;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={
        tab.kind === "terminal"
          ? () => openTerminal({ id: tab.hostId, label: tab.title })
          : undefined
      }
      onAuxClick={(e) => {
        // Middle click closes, like every tabbed editor.
        if (e.button === 1) onClose();
      }}
      className={cn(
        "group relative flex h-full min-w-32 max-w-52 cursor-default items-center gap-2 border-r border-border px-3 text-xs",
        active
          ? "bg-background text-foreground"
          : "bg-surface text-muted-foreground hover:text-foreground",
      )}
    >
      {/* Active-tab indicator: a 1px accent line across the tab's top edge. */}
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
          "shrink-0 rounded p-0.5 transition-opacity hover:bg-accent",
          active
            ? "opacity-60 hover:opacity-100"
            : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100",
        )}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Shortcut hints shown when no tab is open, VSCode watermark style. */
function Watermark() {
  const { t } = useI18n();
  const hints: { label: string; keys: string[] }[] = [
    { label: t("watermark.quickConnect"), keys: ["mod", "P"] },
    { label: t("watermark.commands"), keys: ["mod", "shift", "P"] },
    { label: t("watermark.newHost"), keys: ["mod", "N"] },
    { label: t("watermark.settings"), keys: ["mod", ","] },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background">
      <div className="flex flex-col gap-2.5">
        {hints.map((hint) => (
          <div
            key={hint.label}
            className="grid grid-cols-[1fr_auto] items-center gap-4"
          >
            <span className="text-right text-sm text-muted-foreground">
              {hint.label}
            </span>
            <Kbd keys={hint.keys} />
          </div>
        ))}
      </div>
    </div>
  );
}
