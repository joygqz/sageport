import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const appWindow = getCurrentWindow();

/**
 * Self-drawn minimize/maximize/close buttons for the `decorations: false`
 * windows used on Windows/Linux (see `IS_MACOS` in `lib/platform.ts`).
 * macOS keeps its native inset traffic lights instead and never renders this.
 */
export function WindowControls({ resizable = true }: { resizable?: boolean }) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!resizable) return;
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized);
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [resizable]);

  const buttonClass =
    "flex h-full w-11 items-center justify-center text-surface-foreground/70 transition-colors hover:bg-black/[0.06] dark:hover:bg-white/10";

  return (
    <div className="flex h-full items-center">
      <button
        type="button"
        aria-label={t("windowControls.minimize")}
        className={buttonClass}
        onClick={() => void appWindow.minimize()}
      >
        <Minus className="size-4" />
      </button>
      {resizable && (
        <button
          type="button"
          aria-label={
            maximized
              ? t("windowControls.restore")
              : t("windowControls.maximize")
          }
          className={buttonClass}
          onClick={() => void appWindow.toggleMaximize()}
        >
          {maximized ? (
            <Copy className="size-3.5 -scale-x-100" />
          ) : (
            <Square className="size-3.5" />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label={t("windowControls.close")}
        className={cn(
          buttonClass,
          "hover:bg-destructive hover:text-destructive-foreground",
        )}
        onClick={() => void appWindow.close()}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
