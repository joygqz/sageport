import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock3,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";

import { Button, Field, FormDialog, Input, Select } from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { substitute } from "@/lib/variables";
import type { Task } from "@/types/models";
import { parseTaskSteps } from "./api";
import {
  STEP_META,
  stepSummary,
  taskNeedsRemote,
  taskVariables,
} from "./steps";
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
      title={t("tasks.run.title", { name: task?.name ?? "" })}
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
  const variables = useMemo(() => taskVariables(steps), [steps]);
  const needsHost = useMemo(() => taskNeedsRemote(steps), [steps]);

  // A run for this task may still be executing in the background — reattach to it
  // so reopening the dialog resumes watching its progress instead of starting over.
  const existing = useMemo(
    () => selectRunningRunForTask(useTaskRunStore.getState().runs, task.id),
    [task.id],
  );

  const [hostId, setHostId] = useState(existing?.hostId ?? task.hostId ?? "");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      variables.map((v) => [
        v.name,
        existing?.variables[v.name] ?? v.defaultValue,
      ]),
    ),
  );
  const [requestId, setRequestId] = useState<string | null>(
    existing?.requestId ?? null,
  );
  const run = useTaskRunStore((s) =>
    requestId ? s.runs[requestId] : undefined,
  );
  const running = run?.status === "running";

  // While the dialog shows a run, mark it attached so a background completion
  // doesn't toast and dismiss it out from under us. On close, keep a still-running
  // run alive (it continues in the background) and clean up a finished one.
  useEffect(() => {
    if (!requestId) return;
    attach(requestId);
    return () => {
      detach(requestId);
      const current = useTaskRunStore.getState().runs[requestId];
      if (current && current.status !== "running") dismissRun(requestId);
    };
  }, [requestId, attach, detach, dismissRun]);

  const varsFilled = variables.every(
    (v) => Boolean(v.defaultValue) || (values[v.name] ?? "").trim() !== "",
  );
  const canRun = varsFilled && (!needsHost || Boolean(hostId));

  const onRun = () => {
    if (!canRun || running) return;
    const started = startRun(task, hostId, values);
    setRequestId(started.requestId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-3 overflow-y-auto p-5">
        {needsHost && (
          <Field label={t("tasks.run.targetHost")} required>
            <Select
              value={hostId}
              onValueChange={setHostId}
              disabled={running}
              placeholder={t("tasks.form.selectHost")}
              options={hosts.map((host) => ({
                value: host.id,
                label: host.label,
              }))}
            />
          </Field>
        )}

        {variables.map((variable, index) => (
          <Field
            key={variable.name}
            label={variable.name}
            required={!variable.defaultValue}
          >
            <Input
              autoFocus={index === 0 && !needsHost}
              value={values[variable.name] ?? ""}
              placeholder={variable.defaultValue}
              disabled={running}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [variable.name]: e.target.value,
                }))
              }
            />
          </Field>
        ))}

        {run?.error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-2xs text-danger">
            {run.error}
          </div>
        )}

        {run && (
          <div className="flex flex-col gap-1.5">
            {run.steps.map((_, index) => (
              <StepRow key={index} run={run} values={values} index={index} />
            ))}
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
  run,
  values,
  index,
}: {
  run: TaskRun;
  values: Record<string, string>;
  index: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const step = run.steps[index];
  const state = run.stepStates[index];
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const summary = substitute(stepSummary(step), values);
  const showProgress =
    (step.type === "upload" || step.type === "download") &&
    state.status === "running";
  const body = state.log.trimEnd();

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => body && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
          body ? "hover:bg-list-hover" : "cursor-default",
        )}
      >
        <StatusIcon status={state.status} />
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">{t(meta.labelKey)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {summary}
        </span>
        {state.exitCode !== undefined && state.exitCode !== 0 && (
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

      {showProgress && <TransferProgress state={state} />}

      {open && body && (
        <pre className="max-h-48 overflow-auto border-t border-border bg-surface px-3 py-2 font-mono text-2xs">
          {body}
        </pre>
      )}
      {state.status === "error" && state.message && !body && (
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
          className="h-full rounded-full bg-accent transition-[width]"
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

function StatusIcon({ status }: { status: StepRunState["status"] }) {
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
      return <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />;
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
