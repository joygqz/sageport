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

import { useI18n } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import { useBroadcastStore } from "@/features/terminal/broadcast";
import { statsPercents, useMonitorStore } from "@/features/terminal/monitor";
import { useSyncStatus } from "@/features/sync/api";
import { useSftpStore } from "@/features/sftp/store";
import { useUpdateStatus } from "@/features/updates/api";
import { useLayoutStore } from "./layout";
import {
  targetTerminalId,
  terminalTabs,
  useTabsStore,
  type TerminalStatus,
} from "./tabs";

const statusDot: Record<TerminalStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export function StatusBar() {
  const { t } = useI18n();

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-surface px-1 text-2xs text-muted-foreground">
      <div className="flex h-full items-center">
        <SessionItem />
        <MonitorItem />
        <BroadcastItem />
        <TransfersItem />
      </div>
      <div className="flex h-full items-center">
        <UpdateItem />
        <SyncItem />
        <span className="px-2 tabular-nums">
          {t("statusBar.version", { version: __APP_VERSION__ })}
        </span>
      </div>
    </footer>
  );
}

function StatusBarItem({
  onClick,
  title,
  children,
}: {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-full items-center gap-1.5 rounded-sm px-2 transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  );
}

function SessionItem() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const lastTerminalId = useTabsStore((s) => s.lastTerminalId);
  const setActive = useTabsStore((s) => s.setActive);

  const id = targetTerminalId({ tabs, activeId, lastTerminalId });
  const session = terminalTabs(tabs).find((x) => x.id === id);
  if (!session) return null;

  return (
    <StatusBarItem onClick={() => setActive(session.id)}>
      <span
        className={cn("size-1.5 rounded-full", statusDot[session.status])}
      />
      <span className="max-w-48 truncate">{session.title}</span>
      <span>{t(`terminal.status.${session.status}`)}</span>
    </StatusBarItem>
  );
}

function MonitorItem() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const lastTerminalId = useTabsStore((s) => s.lastTerminalId);
  const bySession = useMonitorStore((s) => s.bySession);

  const id = targetTerminalId({ tabs, activeId, lastTerminalId });
  if (!id) return null;
  const entry = bySession[id];
  if (!entry?.stats) return null;

  const { memUsed, memTotal, diskUsed, diskTotal } = entry.stats;
  const {
    cpu: cpuPct,
    mem: memPct,
    disk: diskPct,
  } = statsPercents(entry.stats);

  return (
    <div
      className="flex h-full items-center gap-3 px-2 tabular-nums"
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
  const openSettings = useTabsStore((s) => s.openSettings);

  const connected = Boolean(status?.provider);
  return (
    <StatusBarItem
      onClick={() => openSettings("sync")}
      title={
        connected && status?.lastSyncedAt
          ? t("statusBar.lastSynced", {
              time: new Date(status.lastSyncedAt).toLocaleString(),
            })
          : undefined
      }
    >
      {connected ? (
        <>
          <Cloud className="size-3" />
          <span>{t("statusBar.syncOn")}</span>
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
  const openSettings = useTabsStore((s) => s.openSettings);

  if (
    status.status !== "available" &&
    status.status !== "downloading" &&
    status.status !== "ready"
  ) {
    return null;
  }

  return (
    <StatusBarItem onClick={() => openSettings("about")}>
      <ArrowUpCircle className="size-3 text-info" />
      <span>
        {status.status === "ready"
          ? t("statusBar.updateReady")
          : t("statusBar.updateAvailable")}
      </span>
    </StatusBarItem>
  );
}
