import { useEffect } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import {
  bridgeMonitorEvents,
  statsPercents,
  useMonitorStore,
} from "@/features/terminal/monitor";
import { useI18n, type TFunction, type TKey } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import type { Host, HostStats } from "@/types/models";
import { SideBarView } from "@/workbench/SideBarView";
import {
  terminalTabs,
  useTabsStore,
  type TerminalStatus,
  type TerminalTab,
} from "@/workbench/tabs";

const statusDot: Record<TerminalStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export function MonitorView() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const { data: hosts = [] } = useHosts();

  useEffect(() => {
    bridgeMonitorEvents();
  }, []);

  const groups = groupByHost(
    terminalTabs(tabs).filter(
      (tab) => tab.target !== "local" && tab.status !== "error",
    ),
  );
  const hostById = new Map(hosts.map((host) => [host.id, host]));

  return (
    <SideBarView title={t("monitor.viewTitle")}>
      {groups.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={t("monitor.empty.title")}
          description={t("monitor.empty.description")}
        />
      ) : (
        <div className="flex flex-col gap-2 px-2 pb-4 pt-1">
          {groups.map((group) => (
            <HostCard
              key={group.key}
              sessions={group.sessions}
              host={hostById.get(group.sessions[0].hostId)}
            />
          ))}
        </div>
      )}
    </SideBarView>
  );
}

function hostKey(tab: TerminalTab): string {
  if (tab.target === "ssh") return `host:${tab.hostId}`;
  if (tab.adhoc)
    return `adhoc:${tab.adhoc.username}@${tab.adhoc.host}:${tab.adhoc.port}`;
  return tab.id;
}

function groupByHost(sessions: TerminalTab[]) {
  const groups: { key: string; sessions: TerminalTab[] }[] = [];
  const byKey = new Map<string, TerminalTab[]>();
  for (const session of sessions) {
    const key = hostKey(session);
    const group = byKey.get(key);
    if (group) {
      group.push(session);
    } else {
      const created = [session];
      byKey.set(key, created);
      groups.push({ key, sessions: created });
    }
  }
  return groups;
}

function hostAddress(session: TerminalTab, host?: Host): string | null {
  if (session.adhoc) {
    const { username, host: addr, port } = session.adhoc;
    return `${username}@${addr}${port === 22 ? "" : `:${port}`}`;
  }
  if (!host) return null;
  const user = host.username ? `${host.username}@` : "";
  return `${user}${host.address}${host.port === 22 ? "" : `:${host.port}`}`;
}

function formatUptime(secs: number, t: TFunction): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return t("monitor.uptimeDh", { d, h });
  if (h > 0) return t("monitor.uptimeHm", { h, m });
  return t("monitor.uptimeM", { m });
}

function HostCard({
  sessions,
  host,
}: {
  sessions: TerminalTab[];
  host?: Host;
}) {
  const { t } = useI18n();
  const setActive = useTabsStore((s) => s.setActive);
  const activeId = useTabsStore((s) => s.activeId);
  const entry = useMonitorStore((s) =>
    sessions
      .map((session) => s.bySession[session.id])
      .find((candidate) => candidate?.stats),
  );
  const unsupported = useMonitorStore((s) =>
    sessions.some((session) => s.bySession[session.id]?.unsupported),
  );

  const primary =
    sessions.find((session) => session.id === activeId) ??
    sessions.find((session) => session.status === "connected") ??
    sessions[0];
  const connected = sessions.some((session) => session.status === "connected");

  const address = hostAddress(primary, host);
  const stats = connected ? entry?.stats : undefined;
  const system = stats
    ? [
        stats.os,
        stats.uptimeSecs !== undefined
          ? t("monitor.uptime", { value: formatUptime(stats.uptimeSecs, t) })
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <button
      onClick={() => setActive(primary.id)}
      className={cn(
        "flex flex-col gap-2.5 rounded-md border border-input p-2.5 text-left transition-colors hover:bg-list-hover",
        sessions.some((session) => session.id === activeId) && "border-ring",
      )}
    >
      <div className="flex w-full flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusDot[connected ? "connected" : primary.status],
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm">
            {primary.title}
          </span>
          {sessions.length > 1 && (
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              ×{sessions.length}
            </span>
          )}
        </div>
        {address && (
          <p className="truncate pl-3.5 font-mono text-2xs text-muted-foreground">
            {address}
          </p>
        )}
        {system && (
          <p className="truncate pl-3.5 text-2xs text-muted-foreground">
            {system}
          </p>
        )}
      </div>

      {stats ? (
        <HostMeters stats={stats} />
      ) : (
        <p className="text-2xs text-muted-foreground">
          {connected
            ? unsupported
              ? t("monitor.unsupported")
              : t("monitor.collecting")
            : t(`terminal.status.${primary.status}`)}
        </p>
      )}
    </button>
  );
}

function HostMeters({ stats }: { stats: HostStats }) {
  const { t } = useI18n();
  const percents = statsPercents(stats);

  return (
    <div className="flex w-full flex-col gap-2">
      <Meter
        icon={Cpu}
        labelKey="monitor.cpu"
        percent={percents.cpu}
        detail={t("monitor.cpuDetail", {
          load: stats.cpuLoad.toFixed(2),
          count: stats.cpuCount,
        })}
      />
      <Meter
        icon={MemoryStick}
        labelKey="monitor.memory"
        percent={percents.mem}
        detail={`${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}`}
      />
      <Meter
        icon={HardDrive}
        labelKey="monitor.disk"
        percent={percents.disk}
        detail={`${formatBytes(stats.diskUsed)} / ${formatBytes(stats.diskTotal)}`}
      />
      {stats.netRxRate !== undefined && stats.netTxRate !== undefined && (
        <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Network className="size-3" />
            {t("monitor.network")}
          </span>
          <span className="flex items-center gap-1.5 tabular-nums">
            <span className="flex items-center gap-0.5">
              <ArrowDown className="size-3" />
              {formatBytes(stats.netRxRate)}/s
            </span>
            <span className="flex items-center gap-0.5">
              <ArrowUp className="size-3" />
              {formatBytes(stats.netTxRate)}/s
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function Meter({
  icon: Icon,
  labelKey,
  percent,
  detail,
}: {
  icon: LucideIcon;
  labelKey: TKey;
  percent: number;
  detail: string;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-1" title={detail}>
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Icon className="size-3" />
          {t(labelKey)}
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            percent >= 90
              ? "bg-destructive"
              : percent >= 75
                ? "bg-warning"
                : "bg-primary",
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
