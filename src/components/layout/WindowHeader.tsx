import type { ReactNode } from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { WindowControls } from "./WindowControls";

/**
 * Draggable header shared by every window (main app + settings/host/group
 * dialogs). Reserves space for macOS's native inset traffic lights; on
 * every other platform it renders `WindowControls` instead, since those
 * windows run with `decorations: false` (see `lib/windows.ts`).
 */
export function WindowHeader({
  title,
  resizable = true,
  children,
}: {
  title: ReactNode;
  resizable?: boolean;
  children?: ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-9 shrink-0 items-center border-b border-border bg-surface",
        IS_MACOS ? "pl-24 pr-5" : "pl-3",
      )}
    >
      <span className="pointer-events-none truncate text-sm font-medium text-surface-foreground">
        {title}
      </span>
      {(children || !IS_MACOS) && (
        <div
          className="ml-auto flex h-full items-center"
          data-tauri-drag-region
        >
          {children && (
            <div className="flex items-center gap-1 pr-2">{children}</div>
          )}
          {!IS_MACOS && <WindowControls resizable={resizable} />}
        </div>
      )}
    </header>
  );
}
