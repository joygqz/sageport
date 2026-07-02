import { useEffect, useRef, useState } from "react";
import { ChevronDown, History, X } from "lucide-react";

import { Button, Tooltip } from "@/components/ui";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { FilePane } from "./FilePane";
import { useSftpStore } from "./store";
import { TransferHistoryDialog } from "./TransferHistoryDialog";

export function SftpPanel() {
  const { t } = useI18n();
  const visible = useSftpStore((s) => s.visible);
  const height = useSftpStore((s) => s.height);
  const ratio = useSftpStore((s) => s.ratio);
  const setHeight = useSftpStore((s) => s.setHeight);
  const setRatio = useSftpStore((s) => s.setRatio);
  const setVisible = useSftpStore((s) => s.setVisible);
  const applyStatus = useSftpStore((s) => s.applyStatus);
  const applyTransfer = useSftpStore((s) => s.applyTransfer);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);
  const transfers = useSftpStore((s) => s.transfers);
  const [historyOpen, setHistoryOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Bridge backend events into the store for the panel's whole lifetime.
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    ipc.sftp
      .onStatus((e) => applyStatus(e.connectionId, e.status, e.message))
      .then((un) => unlisteners.push(un));
    ipc.sftp
      .onTransfer((e) => applyTransfer(e))
      .then((un) => unlisteners.push(un));
    return () => unlisteners.forEach((un) => un());
  }, [applyStatus, applyTransfer]);

  // Re-clamp if the window shrinks after a large drag, so the panel never
  // overflows past the column's available space.
  useEffect(() => {
    const el = panelRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const max = el.clientHeight;
      if (max && height > max) setHeight(max);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, height, setHeight]);

  if (!visible) return null;

  // Cap the height at the column's full available space, so dragging the
  // top border all the way up collapses the terminal above to nothing
  // instead of overflowing the window.
  const onResizeHeight = (h: number) => {
    const max = panelRef.current?.parentElement?.clientHeight;
    setHeight(max ? Math.min(h, max) : h);
  };

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect();
      if (!rect) return;
      setRatio((ev.clientX - rect.left) / rect.width);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const active = Object.values(transfers);

  return (
    <>
      <ResizeHandle axis="y" size={height} reverse onResize={onResizeHeight} />
      <div
        ref={panelRef}
        className="flex shrink-0 flex-col bg-background"
        style={{ height }}
      >
        {/* Header */}
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 select-none">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sftp.title")}
          </span>
          <div className="flex-1" />
          <Tooltip content={t("sftp.history.title")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t("sftp.hide")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-5"
              onClick={() => setVisible(false)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </Tooltip>
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

        {/* Transfer progress strip */}
        {active.length > 0 && (
          <div className="flex max-h-24 flex-col gap-1 overflow-y-auto border-t border-border bg-surface px-2 py-1.5">
            {active.map((tx) => {
              const pct =
                tx.total > 0
                  ? Math.round((tx.transferred / tx.total) * 100)
                  : 0;
              // While compressing/extracting we have no byte denominator, so show
              // an indeterminate bar instead of a stuck 0%.
              const indeterminate =
                tx.status === "active" &&
                tx.total === 0 &&
                (tx.phase === "compressing" || tx.phase === "extracting");
              return (
                <div
                  key={tx.transferId}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="flex w-40 shrink-0 items-baseline gap-1.5 truncate">
                    <span className="truncate" title={tx.file}>
                      {tx.file}
                    </span>
                    {tx.phase && tx.status === "active" && (
                      <span className="shrink-0 text-[0.65rem] text-muted-foreground">
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
                    <Tooltip content={t("sftp.cancel")}>
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
        )}

        <TransferHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      </div>
    </>
  );
}
