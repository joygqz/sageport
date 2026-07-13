import { PanelBottom, PanelRight, Search } from "lucide-react";

import appLogo from "@/assets/app-logo.svg";
import { Kbd, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { WindowControls } from "./WindowControls";

export function TitleBar() {
  const { t } = useI18n();
  const openPalette = useOverlayStore((s) => s.openPalette);
  const panelVisible = useLayoutStore((s) => s.panelVisible);
  const auxVisible = useLayoutStore((s) => s.auxVisible);
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const toggleAux = useLayoutStore((s) => s.toggleAux);

  return (
    <header
      data-tauri-drag-region
      className="grid h-[var(--titlebar-height)] shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center border-b border-border bg-surface/95"
    >
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-full items-center",
          IS_MACOS ? "pl-[5.35rem]" : "pl-2",
        )}
      >
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
        className="flex h-7 items-center justify-center gap-2 rounded-lg border border-border bg-background/65 px-2.5 text-xs text-muted-foreground shadow-sm outline-none transition-[background-color,border-color,color,box-shadow] hover:border-input hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="truncate">{t("titleBar.commandCenter")}</span>
        <Kbd keys={["mod", "P"]} className="h-4 min-w-4 border-0 px-1" />
      </button>

      <div
        data-tauri-drag-region
        className="flex h-full items-center justify-end"
      >
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
            {panelVisible ? (
              <PanelBottomFilled className="size-4" />
            ) : (
              <PanelBottom className="size-4" />
            )}
          </LayoutToggle>
          <LayoutToggle
            label={t("titleBar.toggleAssistant")}
            active={auxVisible}
            onClick={toggleAux}
          >
            {auxVisible ? (
              <PanelRightFilled className="size-4" />
            ) : (
              <PanelRight className="size-4" />
            )}
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
        aria-label={label}
        aria-pressed={active}
        className="flex size-[var(--toolbar-control-size)] items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        {children}
      </button>
    </Tooltip>
  );
}

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
