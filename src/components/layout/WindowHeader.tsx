import type { ReactNode } from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { WindowControls } from "./WindowControls";

/**
 * Draggable header for the app's single OS window. Reserves space for
 * macOS's native inset traffic lights; on every other platform it renders
 * `WindowControls` instead, since the window runs with `decorations: false`.
 */
export function WindowHeader({
  resizable = true,
  children,
}: {
  resizable?: boolean;
  children?: ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "flex h-9 shrink-0 items-center border-b border-border bg-surface",
        IS_MACOS ? "pl-24" : "pl-3",
      )}
    >
      {(children || !IS_MACOS) && (
        <div
          className="ml-auto flex h-full items-center"
          data-tauri-drag-region
        >
          {children && (
            <div className="flex items-center gap-1 pr-4">{children}</div>
          )}
          {!IS_MACOS && <WindowControls resizable={resizable} />}
        </div>
      )}
    </header>
  );
}
