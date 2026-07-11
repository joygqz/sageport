import { Gauge } from "lucide-react";

import {
  bridgeMonitorEvents,
  startMonitor,
  statsPercents,
  useMonitorStore,
} from "@/features/terminal/monitor";
import type { HostStats } from "@/types/models";
import {
  noTerminalSessionError,
  resolveTerminalTab,
  sessionNotConnectedError,
  sleep,
} from "./terminal";
import {
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function humanUptime(secs?: number): string | undefined {
  if (!secs || secs <= 0) return undefined;
  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3_600);
  const minutes = Math.floor((secs % 3_600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatStats(stats: HostStats): string {
  const p = statsPercents(stats);
  return JSON.stringify({
    cpuPercent: p.cpu,
    memPercent: p.mem,
    mem: `${humanBytes(stats.memUsed)} / ${humanBytes(stats.memTotal)}`,
    diskPercent: p.disk,
    disk: `${humanBytes(stats.diskUsed)} / ${humanBytes(stats.diskTotal)}`,
    os: stats.os || undefined,
    uptime: humanUptime(stats.uptimeSecs),
    netRxPerSec:
      stats.netRxRate !== undefined
        ? `${humanBytes(stats.netRxRate)}/s`
        : undefined,
    netTxPerSec:
      stats.netTxRate !== undefined
        ? `${humanBytes(stats.netTxRate)}/s`
        : undefined,
  });
}

async function getHostStats(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const tab = resolveTerminalTab(requested);
  if (!tab) return toolFailure(noTerminalSessionError(requested));
  if (tab.status !== "connected") {
    return toolFailure(sessionNotConnectedError(tab));
  }

  bridgeMonitorEvents();
  startMonitor(tab.id);

  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (context.isCancelled?.()) {
      return toolFailure("Error: the assistant run was stopped.");
    }
    const entry = useMonitorStore.getState().bySession[tab.id];
    if (entry?.unsupported) {
      return toolSuccess(
        `Live stats are not available for "${tab.title}" (the remote host lacks the required tools). Fall back to run_terminal_command with top/free/df.`,
      );
    }
    if (entry?.stats) return toolSuccess(formatStats(entry.stats));
    await sleep(300);
  }
  return toolSuccess(
    `Stats for "${tab.title}" are still loading. Try get_host_stats again in a moment.`,
  );
}

export const monitorTools: AiTool[] = [
  {
    spec: {
      name: "get_host_stats",
      description:
        "Get a live resource snapshot (CPU, memory, disk, uptime, network) for a connected host. Omit sessionId for the Current terminal.",
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description:
              "Session id from list_terminal_sessions. Omit to use the current terminal.",
          },
        },
        additionalProperties: false,
      },
    },
    icon: Gauge,
    labelKey: "ai.tool.getHostStats",
    execute: getHostStats,
  },
];
