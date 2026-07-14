import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, History, Loader2, X } from "lucide-react";

import { Button, ResizeHandle, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useLayoutStore } from "@/workbench/layout";
import {
  PanelHeader,
  PANEL_HEADER_ACTION_CLASS,
} from "@/workbench/PanelHeader";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { FilePane } from "./FilePane";
import { useSftpStore } from "./store";
import { TransferHistoryDialog } from "./TransferHistoryDialog";
import { formatEta } from "./transfer-progress";

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
      className="flex shrink-0 flex-col overflow-hidden border-t border-border bg-surface"
      style={{ height }}
    >
      <PanelHeader
        title={t("sftp.panelTitle")}
        actions={
          <>
            <Tooltip content={t("sftp.toggleHidden")}>
              <Button
                size="icon"
                variant="ghost"
                className={cn(
                  PANEL_HEADER_ACTION_CLASS,
                  showHidden && "text-foreground",
                )}
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
                className={PANEL_HEADER_ACTION_CLASS}
                onClick={() => setHistoryOpen(true)}
              >
                <History className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip content={t("sftp.hidePanel")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                onClick={() => setPanelVisible(false)}
              >
                <X className="size-4" />
              </Button>
            </Tooltip>
          </>
        }
      />

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
    <div className="flex max-h-28 flex-col overflow-y-auto border-t border-border bg-surface px-2.5 py-1">
      {active.map((tx) => {
        const pct =
          tx.total > 0
            ? Math.max(
                0,
                Math.min(100, Math.round((tx.transferred / tx.total) * 100)),
              )
            : 0;

        const indeterminate =
          tx.phase === "preparing" ||
          tx.phase === "compressing" ||
          tx.phase === "extracting";
        const speed =
          tx.phase === "transferring" && tx.speedBps > 0
            ? `${formatBytes(tx.speedBps)}/s`
            : "—";
        return (
          <div
            key={tx.transferId}
            className="flex h-8 items-center gap-2 rounded-md px-1 text-xs hover:bg-list-hover"
          >
            <span className="min-w-0 shrink truncate" title={tx.file}>
              {tx.file}
            </span>
            {tx.cancelRequested ? (
              <span className="shrink-0 text-2xs text-warning">
                {t("sftp.cancelling")}
              </span>
            ) : tx.phase ? (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {t(`sftp.phase.${tx.phase}`)}
              </span>
            ) : null}
            <div className="h-1 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width]",
                  indeterminate && "animate-pulse",
                )}
                style={{ width: `${indeterminate ? 100 : pct}%` }}
              />
            </div>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {indeterminate ? "…" : `${pct}%`}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {speed}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {tx.etaSeconds !== null && tx.speedBps > 0
                ? t("sftp.remaining", { time: formatEta(tx.etaSeconds) })
                : ""}
            </span>
            <Tooltip content={t("sftp.cancelTransfer")}>
              <Button
                size="icon"
                variant="ghost"
                className="size-5 shrink-0 text-muted-foreground hover:text-danger"
                disabled={tx.cancelRequested}
                aria-label={t("sftp.cancelTransfer")}
                onClick={() => cancelTransfer(tx.transferId)}
              >
                {tx.cancelRequested ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
              </Button>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
