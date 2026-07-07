import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, History, X } from "lucide-react";

import { Button, ResizeHandle, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/workbench/layout";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { FilePane } from "./FilePane";
import { useSftpStore } from "./store";
import { TransferHistoryDialog } from "./TransferHistoryDialog";

const PANE_MIN_W = 200;

export function SftpPanel({ height }: { height: number }) {
  const { t } = useI18n();
  const ratio = useSftpStore((s) => s.ratio);
  const setRatio = useSftpStore((s) => s.setRatio);
  const addLocalTab = useSftpStore((s) => s.addLocalTab);
  const showHidden = useSftpStore((s) => s.showHidden);
  const toggleHidden = useSftpStore((s) => s.toggleHidden);
  const setPanelVisible = useLayoutStore((s) => s.setPanelVisible);
  const [historyOpen, setHistoryOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (useSftpStore.getState().panes.left.tabs.length === 0) {
      void addLocalTab("left");
    }
  }, [addLocalTab]);

  const bodyWidth = () => bodyRef.current?.getBoundingClientRect().width ?? 0;

  const splitLimits = () => {
    const width = bodyWidth();
    const min = Math.min(
      PANE_MIN_W * zoomFactor(useZoomStore.getState().level),
      width / 2,
    );
    return { min, max: width - min };
  };

  const setSplit = (px: number) => {
    const width = bodyWidth();
    if (width === 0) return;
    const { min, max } = splitLimits();
    setRatio(Math.max(min, Math.min(px, max)) / width);
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
          <Tooltip content={t("sftp.toggleHidden")}>
            <Button
              size="icon"
              variant="ghost"
              className={cn("size-6", showHidden && "text-foreground")}
              onClick={toggleHidden}
            >
              {showHidden ? (
                <Eye className="size-4" />
              ) : (
                <EyeOff className="size-4" />
              )}
            </Button>
          </Tooltip>
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

      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${ratio * 100}%` }} className="flex min-w-0">
          <FilePane side="left" />
        </div>
        <ResizeHandle
          axis="x"
          getSize={() => ratio * bodyWidth()}
          onResize={setSplit}
          limits={splitLimits}
        />
        <div className="flex min-w-0 flex-1">
          <FilePane side="right" />
        </div>
      </div>

      <TransferStrip />

      <TransferHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

function TransferStrip() {
  const { t } = useI18n();
  const transfers = useSftpStore((s) => s.transfers);
  const cancelTransfer = useSftpStore((s) => s.cancelTransfer);

  const active = Object.values(transfers);
  if (active.length === 0) return null;

  return (
    <div className="flex max-h-24 flex-col overflow-y-auto border-t border-border bg-surface px-2">
      {active.map((tx) => {
        const pct =
          tx.total > 0 ? Math.round((tx.transferred / tx.total) * 100) : 0;

        const indeterminate =
          tx.total === 0 &&
          (tx.phase === "compressing" || tx.phase === "extracting");
        return (
          <div
            key={tx.transferId}
            className="flex h-7 items-center gap-2 text-xs"
          >
            <span className="min-w-0 shrink truncate" title={tx.file}>
              {tx.file}
            </span>
            {tx.phase && (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {t(`sftp.phase.${tx.phase}`)}
              </span>
            )}
            <div className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all",
                  indeterminate && "animate-pulse",
                )}
                style={{ width: `${indeterminate ? 100 : pct}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
              {indeterminate ? "…" : `${pct}%`}
            </span>
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
          </div>
        );
      })}
    </div>
  );
}
