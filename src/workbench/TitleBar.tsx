import { PanelBottom, PanelRight, Search } from "lucide-react";

import { Kbd, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { WindowControls } from "./WindowControls";

/**
 * Draggable window title bar. The center hosts the command center (quick
 * open trigger); the right edge holds layout toggles and, on platforms
 * without native decorations, the window controls.
 */
export function TitleBar() {
  const { t } = useI18n();
  const openPalette = useOverlayStore((s) => s.openPalette);
  const panelVisible = useLayoutStore((s) => s.panelVisible);
  const auxVisible = useLayoutStore((s) => s.auxVisible);
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const toggleAux = useLayoutStore((s) => s.toggleAux);

  return (
    // ~34px, the height VSCode's title bar uses with the command center.
    // Sized in rem (h-9) so the whole bar scales with the UI zoom, exactly
    // like VSCode. The native macOS traffic lights are re-centered to this
    // bar's live height at runtime (public AppKit API — see
    // syncTrafficLights in workbench/zoom.ts and the
    // window_set_traffic_light_inset command), so they track zoom, window
    // resizes and theme changes. If h-9 ever changes, update TITLE_BAR_REM
    // in zoom.ts to match.
    <header
      data-tauri-drag-region
      className={cn(
        "grid h-9 shrink-0 grid-cols-[1fr_minmax(0,26rem)_1fr] items-center border-b border-border bg-surface",
        // rem-based so the reserved traffic-light space scales with zoom,
        // in step with the lights' own scaled inset (see zoom.ts).
        IS_MACOS ? "pl-[5.35rem]" : "pl-2",
      )}
    >
      <div data-tauri-drag-region className="h-full" />

      <button
        onClick={() => openPalette("quick")}
        className="flex h-6 items-center justify-center gap-2 rounded-md border border-border bg-background/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="truncate">{t("titleBar.commandCenter")}</span>
        <Kbd keys={["mod", "P"]} className="h-4 min-w-4 border-0 px-1" />
      </button>

      <div
        data-tauri-drag-region
        className="flex h-full items-center justify-end"
      >
        {/* Same metrics as the panel-header action rows below (size-6
            buttons, gap-0.5, right padding pr-2), so this column of icons
            lines up with the AI panel's actions on the same right edge. */}
        <div
          className={cn(
            "flex items-center gap-0.5 pl-1.5",
            IS_MACOS ? "pr-2" : "pr-1",
          )}
        >
          <LayoutToggle
            label={t("titleBar.togglePanel")}
            active={panelVisible}
            onClick={togglePanel}
          >
            <PanelBottom className="size-4" />
          </LayoutToggle>
          <LayoutToggle
            label={t("titleBar.toggleAssistant")}
            active={auxVisible}
            onClick={toggleAux}
          >
            <PanelRight className="size-4" />
          </LayoutToggle>
        </div>
        {!IS_MACOS && <WindowControls />}
      </div>
    </header>
  );
}

function LayoutToggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex size-6 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
