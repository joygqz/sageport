import type { TransferEvent } from "@/types/models";

export interface ActiveTransfer extends TransferEvent {
  sourceConnectionId: string | null;
  destConnectionId: string | null;
  cancelRequested: boolean;
  rateStartedAt: number;
  rateStartedBytes: number;
  speedBps: number;
  etaSeconds: number | null;
}

export function pendingTransfer(
  event: TransferEvent,
  sourceConnectionId: string | null,
  destConnectionId: string | null,
  now = Date.now(),
): ActiveTransfer {
  return {
    ...event,
    sourceConnectionId,
    destConnectionId,
    cancelRequested: false,
    rateStartedAt: now,
    rateStartedBytes: event.transferred,
    speedBps: 0,
    etaSeconds: null,
  };
}

export function updateTransferProgress(
  previous: ActiveTransfer | undefined,
  event: TransferEvent,
  now = Date.now(),
): ActiveTransfer {
  const current = previous ?? pendingTransfer(event, null, null, now);
  const enteredTransferPhase =
    event.phase === "transferring" && current.phase !== "transferring";
  const restarted = event.transferred < current.transferred;
  const rateStartedAt =
    enteredTransferPhase || restarted ? now : current.rateStartedAt;
  const rateStartedBytes =
    enteredTransferPhase || restarted
      ? event.transferred
      : current.rateStartedBytes;
  const elapsedSeconds = Math.max(0, (now - rateStartedAt) / 1000);
  const transferredSinceStart = Math.max(
    0,
    event.transferred - rateStartedBytes,
  );
  const measuringTransfer =
    event.phase === "transferring" || event.phase === undefined;
  const speedBps =
    measuringTransfer && elapsedSeconds >= 0.25
      ? transferredSinceStart / elapsedSeconds
      : current.speedBps;
  const remaining = Math.max(0, event.total - event.transferred);
  const etaSeconds =
    event.total > 0 && speedBps > 0 ? remaining / speedBps : null;

  return {
    ...current,
    ...event,
    cancelRequested: current.cancelRequested,
    rateStartedAt,
    rateStartedBytes,
    speedBps,
    etaSeconds,
  };
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
