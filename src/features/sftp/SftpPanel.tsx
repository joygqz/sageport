import { useEffect, useRef, useState } from "react";
import { History, X } from "lucide-react";

import { Button, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/workbench/layout";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { FilePane } from "./FilePane";
import { useSftpStore } from "./store";
import { TransferHistoryDialog } from "./TransferHistoryDialog";

/** Minimum width of one file pane, in CSS px at zoom level 0. */
const PANE_MIN_W = 200;

/**
 * The bottom panel: a dual-pane file browser (local or SFTP on either
 * side) with drag-and-drop transfer between the panes and a live progress
 * strip along the bottom edge.
 */
export function SftpPanel({ height }: { height: number }) {
  const { t } = useI18n();
  const ratio = useSftpStore((s) => s.ratio);
  const setRatio = useSftpStore((s) => s.setRatio);
  const hasLeftTabs = useSftpStore((s) => s.panes.left.tabs.length > 0);
  const addLocalTab = useSftpStore((s) => s.addLocalTab);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const [historyOpen, setHistoryOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  // Seed the left pane with the local filesystem the first time the panel
  // opens; the right pane stays empty until the user picks a destination.
  useEffect(() => {
    if (!hasLeftTabs) void addLocalTab("left");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      // Each pane keeps a usable minimum width (in px, so it holds at any
      // panel size, and zoom-scaled like every layout constraint). When the
      // panel is too narrow for two minimums the divider stays centered.
      const min = Math.min(
        (PANE_MIN_W * zoomFactor(useZoomStore.getState().level)) / rect.width,
        0.5,
      );
      const ratio = (ev.clientX - rect.left) / rect.width;
      setRatio(Math.max(min, Math.min(ratio, 1 - min)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden bg-background"
      style={{ height }}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-surface pl-4 pr-2">
        <h2 className="truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("sftp.panelTitle")}
        </h2>
        <div className="flex items-center gap-0.5">
          <Tooltip content={t("sftp.history.title")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("sftp.hidePanel")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => setPanelVisible(false)}
            >
              <X className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Two panes with a draggable divider */}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${ratio * 100}%` }} className="flex min-w-0">
          <FilePane side="left" />
        </div>
        <div className="group relative z-10 w-0 shrink-0 select-none">
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary group-active:bg-primary" />
          <div
            onPointerDown={startSplitDrag}
            className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize"
          />
        </div>
        <div className="flex min-w-0 flex-1">
          <FilePane side="right" />
        </div>
      </div>

      <TransferStrip />

      <TransferHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

/** Live progress for in-flight and just-finished transfers. */
function TransferStrip() {
  const { t } = useI18n();
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);

  const active = Object.values(transfers);
  if (active.length === 0) return null;

  return (
    <div className="flex max-h-24 flex-col gap-1 overflow-y-auto border-t border-border bg-surface px-2 py-1.5">
      {active.map((tx) => {
        const pct =
          tx.total > 0 ? Math.round((tx.transferred / tx.total) * 100) : 0;
        // While compressing/extracting there is no byte denominator, so show
        // an indeterminate bar instead of a stuck 0%.
        const indeterminate =
          tx.status === "active" &&
          tx.total === 0 &&
          (tx.phase === "compressing" || tx.phase === "extracting");
        return (
          <div key={tx.transferId} className="flex items-center gap-2 text-xs">
            <span className="flex w-40 shrink-0 items-baseline gap-1.5 truncate">
              <span className="truncate" title={tx.file}>
                {tx.file}
              </span>
              {tx.phase && tx.status === "active" && (
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {t(`sftp.phase.${tx.phase}`)}
                </span>
              )}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  tx.status === "error"
                    ? "bg-destructive"
                    : tx.status === "cancelled"
                      ? "bg-muted-foreground/50"
                      : "bg-primary",
                  indeterminate && "animate-pulse",
                )}
                style={{
                  width: `${
                    tx.status === "done" || tx.status === "cancelled"
                      ? 100
                      : indeterminate
                        ? 100
                        : pct
                  }%`,
                }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-muted-foreground">
              {tx.status === "error"
                ? "!"
                : tx.status === "done"
                  ? "✓"
                  : tx.status === "cancelled"
                    ? "×"
                    : indeterminate
                      ? "…"
                      : `${pct}%`}
            </span>
            {tx.status === "active" && (
              <Tooltip content={t("sftp.cancelTransfer")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => cancelTransfer(tx.transferId)}
                >
                  <X className="size-3" />
                </Button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
