import {
  ArrowUpCircle,
  Cloud,
  CloudOff,
  Cpu,
  FolderSync,
  HardDrive,
  MemoryStick,
  Radio,
} from "lucide-react";
import { memo, type ButtonHTMLAttributes } from "react";

import { useI18n } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useBroadcastStore } from "@/features/terminal/broadcast";
import { statsPercents, useMonitorStore } from "@/features/terminal/monitor";
import { useSyncStatus } from "@/features/sync/api";
import { useSftpStore } from "@/features/sftp/store";
import { useUpdateStatus } from "@/features/updates/api";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { STATUS_DOT_CLASS } from "./tab-styles";
import { findPane, paneTab, targetPaneId, useTabsStore } from "./tabs";

const STATUS_BAR_ITEM_LAYOUT_CLASS =
  "flex h-full items-center gap-1.5 whitespace-nowrap px-2 [&_svg]:shrink-0";

export const StatusBar = memo(function StatusBar() {
  const { t } = useI18n();

  return (
    <footer className="flex h-[var(--statusbar-height)] shrink-0 select-none items-center justify-between border-t border-border bg-surface/95 text-2xs text-muted-foreground">
      <div className="flex h-full min-w-0 items-center overflow-hidden">
        <SessionItem />
        <MonitorItem />
        <BroadcastItem />
        <TransfersItem />
      </div>
      <div className="flex h-full shrink-0 items-center">
        <UpdateItem />
        <SyncItem />
        <span className="flex h-full shrink-0 items-center whitespace-nowrap px-2 tabular-nums">
          {t("statusBar.version", { version: __APP_VERSION__ })}
        </span>
      </div>
    </footer>
  );
});

function StatusBarItem({
  onClick,
  title,
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick: () => void;
}) {
  return (
    <button
      {...props}
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        STATUS_BAR_ITEM_LAYOUT_CLASS,
        "outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35",
        className,
      )}
    >
      {children}
    </button>
  );
}

function SessionItem() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const lastPaneId = useTabsStore((s) => s.lastPaneId);
  const setActive = useTabsStore((s) => s.setActive);

  const id = targetPaneId({ tabs, activeId, lastPaneId });
  const session = findPane(tabs, id);
  if (!session) return null;

  const content = (
    <>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          STATUS_DOT_CLASS[session.status],
        )}
      />
      <span className="max-w-48 truncate">{session.title}</span>
      <span>{t(`terminal.status.${session.status}`)}</span>
    </>
  );
  const canActivate = paneTab(tabs, session.id)?.id !== activeId;

  return canActivate ? (
    <StatusBarItem className="min-w-0" onClick={() => setActive(session.id)}>
      {content}
    </StatusBarItem>
  ) : (
    <div className={cn(STATUS_BAR_ITEM_LAYOUT_CLASS, "min-w-0")}>{content}</div>
  );
}

function MonitorItem() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const lastPaneId = useTabsStore((s) => s.lastPaneId);
  const bySession = useMonitorStore((s) => s.bySession);

  const id = targetPaneId({ tabs, activeId, lastPaneId });
  if (!id) return null;
  const session = findPane(tabs, id);
  const entry = bySession[id];
  if (!session || entry?.attempt !== session.attempt || !entry.stats) {
    return null;
  }

  const { memUsed, memTotal, diskUsed, diskTotal } = entry.stats;
  const {
    cpu: cpuPct,
    mem: memPct,
    disk: diskPct,
  } = statsPercents(entry.stats);

  return (
    <div
      className="flex h-full shrink-0 items-center gap-3 whitespace-nowrap px-2 tabular-nums [&_svg]:shrink-0"
      title={t("statusBar.monitorHint")}
    >
      <span className="flex items-center gap-1">
        <Cpu className="size-3" />
        {cpuPct}%
      </span>
      <span
        className="flex items-center gap-1"
        title={`${formatBytes(memUsed)} / ${formatBytes(memTotal)}`}
      >
        <MemoryStick className="size-3" />
        {memPct}%
      </span>
      <span
        className="flex items-center gap-1"
        title={`${formatBytes(diskUsed)} / ${formatBytes(diskTotal)}`}
      >
        <HardDrive className="size-3" />
        {diskPct}%
      </span>
    </div>
  );
}

function BroadcastItem() {
  const { t } = useI18n();
  const enabled = useBroadcastStore((s) => s.enabled);
  const toggle = useBroadcastStore((s) => s.toggle);
  if (!enabled) return null;

  return (
    <StatusBarItem onClick={toggle} title={t("statusBar.broadcastHint")}>
      <Radio className="size-3 animate-pulse text-warning" />
      <span>{t("statusBar.broadcast")}</span>
    </StatusBarItem>
  );
}

function TransfersItem() {
  const { t } = useI18n();
  const togglePanel = useLayoutStore((s) => s.togglePanel);
  const activeCount = useSftpStore(
    (s) =>
      Object.values(s.transfers).filter((x) => x.status === "active").length,
  );
  if (activeCount === 0) return null;

  return (
    <StatusBarItem onClick={togglePanel}>
      <FolderSync className="size-3 animate-pulse" />
      <span>{t("statusBar.transfers", { count: activeCount })}</span>
    </StatusBarItem>
  );
}

function SyncItem() {
  const { t } = useI18n();
  const { data: status } = useSyncStatus();
  const openSettings = useOverlayStore((s) => s.openSettings);

  if (!status) return null;
  const connected = Boolean(status.provider);
  return (
    <StatusBarItem
      onClick={() => openSettings("sync")}
      aria-haspopup="dialog"
      title={
        status.autoSyncError
          ? t("statusBar.syncError", { error: status.autoSyncError })
          : connected && status.lastSyncedAt
            ? t("statusBar.lastSynced", {
                time: new Date(status.lastSyncedAt).toLocaleString(),
              })
            : undefined
      }
    >
      {connected ? (
        <>
          <Cloud
            className={cn(
              "size-3",
              status.autoSyncInProgress && "animate-pulse",
            )}
          />
          <span>
            {t(
              status.autoSyncInProgress
                ? "statusBar.syncPending"
                : "statusBar.syncOn",
            )}
          </span>
        </>
      ) : (
        <>
          <CloudOff className="size-3" />
          <span>{t("statusBar.syncOff")}</span>
        </>
      )}
    </StatusBarItem>
  );
}

function UpdateItem() {
  const { t } = useI18n();
  const status = useUpdateStatus();
  const openSettings = useOverlayStore((s) => s.openSettings);

  if (
    status.status !== "available" &&
    status.status !== "downloading" &&
    status.status !== "ready"
  ) {
    return null;
  }

  return (
    <StatusBarItem onClick={() => openSettings("about")} aria-haspopup="dialog">
      <ArrowUpCircle className="size-3 text-info" />
      <span>
        {status.status === "ready"
          ? t("statusBar.updateReady")
          : t("statusBar.updateAvailable")}
      </span>
    </StatusBarItem>
  );
}
