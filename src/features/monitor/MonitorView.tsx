import { useEffect, useState } from "react";
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

import {
  CONTROL_BORDER_CLASS,
  CONTROL_FOCUS_CLASS,
  EmptyState,
} from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import {
  bridgeMonitorEvents,
  statsPercents,
  useMonitorStore,
} from "@/features/terminal/monitor";
import { useI18n, type TFunction, type TKey } from "@/i18n";
import { cn, formatBytes } from "@/lib/utils";
import type { Host, HostStats } from "@/types/models";
import { PanelContent } from "@/workbench/PanelHeader";
import { SideBarView } from "@/workbench/SideBarView";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import { STATUS_DOT_CLASS } from "@/workbench/tab-styles";
import {
  terminalPanes,
  useTabsStore,
  type TerminalPane,
} from "@/workbench/tabs";

export function MonitorView() {
  const { t } = useI18n();
  const tabs = useTabsStore((s) => s.tabs);
  const { data: hosts = [] } = useHosts();
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  useEffect(() => {
    void bridgeMonitorEvents().catch(() => {});
  }, []);

  const groups = groupByHost(
    terminalPanes(tabs).filter((pane) => pane.target !== "local"),
  );
  const hostById = new Map(hosts.map((host) => [host.id, host]));
  const q = query.trim().toLowerCase();
  const filteredGroups = q
    ? groups.filter((group) => {
        const host = hostById.get(group.sessions[0].hostId);
        return [
          group.key,
          host?.label ?? "",
          host?.address ?? "",
          ...group.sessions.flatMap((session) => [
            session.title,
            session.adhoc?.host ?? "",
            session.adhoc?.username ?? "",
          ]),
        ].some((value) => value.toLowerCase().includes(q));
      })
    : groups;

  return (
    <SideBarView
      title={t("monitor.viewTitle")}
      topContent={
        <SideBarFilter
          itemCount={groups.length}
          value={query}
          onChange={setQuery}
          placeholder={t("monitor.filterPlaceholder")}
          threshold={3}
        />
      }
    >
      <PanelContent className="flex flex-col gap-2.5">
        {filteredGroups.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title={
              searching ? t("monitor.noMatches") : t("monitor.empty.title")
            }
            description={searching ? undefined : t("monitor.empty.description")}
            fill={!searching}
          />
        ) : (
          filteredGroups.map((group) => (
            <HostCard
              key={group.key}
              sessions={group.sessions}
              host={hostById.get(group.sessions[0].hostId)}
            />
          ))
        )}
      </PanelContent>
    </SideBarView>
  );
}

function hostKey(tab: TerminalPane): string {
  if (tab.target === "ssh") return `host:${tab.hostId}`;
  if (tab.adhoc)
    return JSON.stringify([
      "adhoc",
      tab.adhoc.username,
      tab.adhoc.host.toLowerCase(),
      tab.adhoc.port,
    ]);
  return tab.id;
}

function groupByHost(sessions: TerminalPane[]) {
  const groups: { key: string; sessions: TerminalPane[] }[] = [];
  const byKey = new Map<string, TerminalPane[]>();
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

function hostAddress(session: TerminalPane, host?: Host): string | null {
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
  sessions: TerminalPane[];
  host?: Host;
}) {
  const { t } = useI18n();
  const setActive = useTabsStore((s) => s.setActive);
  const activeId = useTabsStore((s) => {
    const active = s.tabs.find((tab) => tab.id === s.activeId);
    return active?.kind === "terminal" ? active.activePaneId : null;
  });
  const connectedSessions = sessions.filter(
    (session) => session.status === "connected",
  );
  const entry = useMonitorStore((s) =>
    connectedSessions
      .map((session) => s.bySession[session.id])
      .find(
        (candidate, index) =>
          candidate?.attempt === connectedSessions[index]?.attempt &&
          Boolean(candidate.stats),
      ),
  );
  const unsupported = useMonitorStore(
    (s) =>
      connectedSessions.length > 0 &&
      connectedSessions.every((session) => {
        const candidate = s.bySession[session.id];
        return (
          candidate?.attempt === session.attempt &&
          candidate.unsupported === true
        );
      }),
  );

  const primary =
    connectedSessions.find((session) => session.id === activeId) ??
    connectedSessions[0] ??
    sessions.find((session) => session.id === activeId) ??
    sessions[0];
  const active = sessions.some((session) => session.id === activeId);
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
      type="button"
      onClick={() => setActive(primary.id)}
      className={cn(
        "group flex flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-[background-color,border-color,box-shadow] hover:bg-muted",
        CONTROL_FOCUS_CLASS,
        active
          ? "border-ring/70 bg-card ring-1 ring-ring/20"
          : CONTROL_BORDER_CLASS,
      )}
    >
      <div className="flex w-full flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <div className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-link">
            <Gauge className="size-4" strokeWidth={1.7} />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-card group-hover:ring-muted",
                STATUS_DOT_CLASS[connected ? "connected" : primary.status],
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-card-foreground">
              {primary.title}
            </p>
            {address && (
              <p className="truncate font-mono text-2xs text-muted-foreground">
                {address}
              </p>
            )}
          </div>
          {sessions.length > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
              ×{sessions.length}
            </span>
          )}
        </div>
        {system && (
          <p className="mt-1 truncate pl-10 text-2xs text-muted-foreground">
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
      <div
        role="progressbar"
        aria-label={t(labelKey)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-muted-foreground/15"
      >
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
