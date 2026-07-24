import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Loader2,
  Play,
  Server,
  Square,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button, FormDialog } from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { nextCronTime } from "@/lib/cron";
import { cn } from "@/lib/utils";
import type { Task, TaskStep } from "@/types/models";
import { parseTaskSteps } from "./api";
import { STEP_META, stepSummary, taskNeedsRemote } from "./steps";
import {
  selectRunningRunForTask,
  useTaskRunStore,
  type StepRunState,
  type TaskRun,
} from "./store";

export function TaskRunDialog({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={Boolean(task)}
      onClose={onClose}
      width="w-[620px]"
      title={t("tasks.run.title")}
    >
      {task && <RunBody task={task} onClose={onClose} />}
    </FormDialog>
  );
}

function RunBody({ task, onClose }: { task: Task; onClose: () => void }) {
  const { t } = useI18n();
  const { data: hosts = [] } = useHosts();
  const startRun = useTaskRunStore((s) => s.startRun);
  const cancelRun = useTaskRunStore((s) => s.cancelRun);
  const dismissRun = useTaskRunStore((s) => s.dismissRun);
  const attach = useTaskRunStore((s) => s.attach);
  const detach = useTaskRunStore((s) => s.detach);

  const steps = useMemo(() => parseTaskSteps(task), [task]);
  const needsHost = useMemo(() => taskNeedsRemote(steps), [steps]);

  const existing = useMemo(
    () => selectRunningRunForTask(useTaskRunStore.getState().runs, task.id),
    [task.id],
  );

  const hostId = existing?.hostId ?? task.hostId ?? "";
  const hostLabel = hosts.find((host) => host.id === hostId)?.label ?? hostId;
  const [requestId, setRequestId] = useState<string | null>(
    existing?.requestId ?? null,
  );
  const run = useTaskRunStore((s) =>
    requestId ? s.runs[requestId] : undefined,
  );
  const running = run?.status === "running";

  useEffect(() => {
    if (!requestId) return;
    attach(requestId);
    return () => {
      detach(requestId);
      const current = useTaskRunStore.getState().runs[requestId];
      if (current && current.status !== "running") dismissRun(requestId);
    };
  }, [requestId, attach, detach, dismissRun]);

  const canRun = !needsHost || Boolean(hostId);

  const onRun = () => {
    if (!canRun || running) return;
    const started = startRun(task, hostId);
    setRequestId(started.requestId);
  };

  const description = task.description?.trim();
  const nextRun =
    task.scheduleEnabled && task.schedule
      ? nextCronTime(task.schedule, new Date())
      : null;
  const scheduleValue = nextRun
    ? t("tasks.schedule.nextShort", { time: nextRun.toLocaleString() })
    : task.scheduleEnabled && task.schedule
      ? task.schedule
      : null;

  const stepList = run?.steps ?? steps;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-4 overflow-y-auto p-5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="truncate text-base font-semibold leading-tight">
            {task.name}
          </h3>
          {description && (
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
          {((needsHost && hostId) || scheduleValue) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {needsHost && hostId && (
                <MetaChip icon={Server}>{hostLabel}</MetaChip>
              )}
              {scheduleValue && (
                <MetaChip icon={CalendarClock}>{scheduleValue}</MetaChip>
              )}
            </div>
          )}
        </div>

        {needsHost && !hostId && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs text-danger">
            {t("tasks.form.hostRequired")}
          </div>
        )}

        {run?.error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs text-danger">
            {run.error}
          </div>
        )}

        {stepList.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-0.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("tasks.form.steps")}
              </span>
              <span className="flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium tabular-nums text-muted-foreground">
                {stepList.length}
              </span>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {stepList.map((step, index) => (
                <StepRow
                  key={index}
                  index={index}
                  step={step}
                  state={run?.stepStates[index]}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface/30 px-5 py-3">
        <RunSummary run={run} />
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
        {running ? (
          <Button
            variant="destructive"
            onClick={() => requestId && cancelRun(requestId)}
          >
            <Square className="size-4" />
            {t("tasks.run.cancel")}
          </Button>
        ) : (
          <Button onClick={onRun} disabled={!canRun}>
            <Play className="size-4" />
            {run ? t("tasks.run.runAgain") : t("tasks.run.run")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-2xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{children}</span>
    </span>
  );
}

function RunSummary({ run }: { run: TaskRun | undefined }) {
  const { t } = useI18n();
  if (!run) return <div className="mr-auto" />;
  const done = run.stepStates.filter((s) =>
    ["done", "error", "skipped"].includes(s.status),
  ).length;
  const label =
    run.status === "running"
      ? t("tasks.run.progress", { done, total: run.steps.length })
      : run.status === "done"
        ? t("tasks.run.succeeded")
        : run.status === "cancelled"
          ? t("tasks.run.cancelled")
          : t("tasks.run.failed");
  return (
    <span
      className={cn(
        "mr-auto text-xs",
        run.status === "error" && "text-danger",
        run.status === "done" && "text-success",
        run.status === "running" && "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function StepRow({
  index,
  step,
  state,
}: {
  index: number;
  step: TaskStep;
  state: StepRunState | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const status = state?.status ?? "pending";
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const summary = stepSummary(step);
  const showProgress =
    (step.type === "upload" || step.type === "download") &&
    status === "running";
  const body = state?.log.trimEnd() ?? "";

  return (
    <div>
      <button
        type="button"
        onClick={() => body && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
          body ? "hover:bg-list-hover" : "cursor-default",
        )}
      >
        <StatusIcon status={status} index={index} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">{t(meta.labelKey)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {summary}
        </span>
        {state?.exitCode !== undefined && state.exitCode !== 0 && (
          <span className="shrink-0 font-mono text-2xs text-danger">
            exit {state.exitCode}
          </span>
        )}
        {body && (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      {showProgress && state && <TransferProgress state={state} />}

      {open && body && (
        <pre className="max-h-48 overflow-auto border-t border-border bg-surface px-3 py-2 font-mono text-2xs">
          {body}
        </pre>
      )}
      {status === "error" && state?.message && !body && (
        <p className="border-t border-border px-3 py-2 text-2xs text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

function TransferProgress({ state }: { state: StepRunState }) {
  const total = state.total ?? 0;
  const transferred = state.transferred ?? 0;
  const percent = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
        {formatBytes(transferred)}
        {total > 0 ? ` / ${formatBytes(total)}` : ""}
      </span>
    </div>
  );
}

function StatusIcon({
  status,
  index,
}: {
  status: StepRunState["status"];
  index: number;
}) {
  switch (status) {
    case "running":
      return (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-warning" />
      );
    case "done":
      return <CheckCircle2 className="size-3.5 shrink-0 text-success" />;
    case "error":
      return <XCircle className="size-3.5 shrink-0 text-danger" />;
    case "skipped":
      return (
        <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" />
      );
    default:
      return (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-2xs font-medium text-muted-foreground">
          {index + 1}
        </span>
      );
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
