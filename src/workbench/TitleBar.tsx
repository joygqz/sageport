import { PanelBottom, PanelRight, Search } from "lucide-react";

import appLogo from "@/assets/app-logo.svg";
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
 * without native decorations, the window controls plus a VSCode-style app
 * logo on the left (macOS has the traffic lights there instead).
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
    // bar's live height at runtime: syncTrafficLights in workbench/zoom.ts
    // declares the inset on zoom/theme changes, and the native side keeps
    // re-applying it through window resizes (see
    // src-tauri/src/commands/window.rs). If h-9 ever changes, update
    // TITLE_BAR_REM in zoom.ts to match.
    <header
      data-tauri-drag-region
      className={cn(
        "grid h-9 shrink-0 grid-cols-[1fr_minmax(0,26rem)_1fr] items-center border-b border-border bg-surface",
        // rem-based so the reserved traffic-light space scales with zoom,
        // in step with the lights' own scaled inset (see zoom.ts).
        IS_MACOS ? "pl-[5.35rem]" : "pl-2",
      )}
    >
      <div data-tauri-drag-region className="flex h-full items-center">
        {/* App logo, VSCode-style: 16px CSS (size-4, rem-based so it zooms
            with the UI), generated from the master icon by `pnpm icon`.
            pointer-events-none keeps mousedown on the drag-region div so
            dragging and double-click-to-maximize still work over it. */}
        {!IS_MACOS && (
          <img
            src={appLogo}
            alt=""
            draggable={false}
            className="pointer-events-none size-4 shrink-0 select-none"
          />
        )}
      </div>

      <button
        onClick={() => openPalette("quick")}
        className="flex h-6 items-center justify-center gap-2 rounded-md border border-input bg-background/60 px-2 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
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
            {panelVisible
              ? <PanelBottomFilled className="size-4" />
              : <PanelBottom className="size-4" />}
          </LayoutToggle>
          <LayoutToggle
            label={t("titleBar.toggleAssistant")}
            active={auxVisible}
            onClick={toggleAux}
          >
            {auxVisible
              ? <PanelRightFilled className="size-4" />
              : <PanelRight className="size-4" />}
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
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        {children}
      </button>
    </Tooltip>
  );
}

// Filled counterparts of lucide's PanelBottom / PanelRight (same 24px
// grid and stroke metrics). Visibility is conveyed VSCode-style: filled
// section = open, outline = closed.
function PanelBottomFilled({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path
        d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function PanelRightFilled({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path
        d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
