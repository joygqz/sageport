import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  Clock,
  Clock3,
  History,
  ListChecks,
  Server,
  Timer,
  Trash2,
  Workflow,
  XCircle,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogToolbar,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaItem,
  ScrollArea,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorDescription, errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  TaskRunHistoryEntry,
  TaskRunResultStatus,
  TaskRunStepRecord,
  TaskRunStepStatus,
} from "@/types/models";
import { useClearTaskRuns, useDeleteTaskRun, useTaskRuns } from "./api";
import { STEP_META, stepSummary } from "./steps";

const statusVariant: Record<
  TaskRunResultStatus,
  "primary" | "success" | "destructive" | "default"
> = {
  running: "primary",
  done: "success",
  error: "destructive",
  cancelled: "default",
};

export function TaskRunHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useTaskRuns(open);
  const deleteOne = useDeleteTaskRun();
  const clearAll = useClearTaskRuns();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const entries = data ?? [];

  const onClear = async () => {
    try {
      await clearAll.mutateAsync();
    } catch (err) {
      toast.error(t("tasks.history.clearError"), errorMessage(err));
    }
  };

  const onDeleteOne = async (id: string) => {
    try {
      await deleteOne.mutateAsync(id);
    } catch (err) {
      toast.error(t("tasks.history.deleteError"), errorDescription(err));
    }
  };

  const confirmClear = () => {
    setConfirmState({
      title: t("tasks.history.clearTitle"),
      description: t("tasks.history.clearConfirm"),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("tasks.history.clear"),
          variant: "destructive",
          onSelect: () => void onClear(),
        },
      ],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        scrollMode="content"
        className="flex h-[min(70vh,620px)] max-w-2xl flex-col gap-0 p-0 sm:p-0"
        onInteractOutside={(event) => {
          if (confirmState) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (confirmState) event.preventDefault();
        }}
      >
        <DialogToolbar
          actions={
            entries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-[var(--toolbar-control-size)] text-muted-foreground hover:text-danger"
                onClick={confirmClear}
                disabled={clearAll.isPending}
              >
                <Trash2 /> {t("tasks.history.clear")}
              </Button>
            )
          }
        >
          {t("tasks.history.title")}
        </DialogToolbar>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          {isLoading ? (
            <LoadingState label={t("common.loading")} fill />
          ) : isError ? (
            <ErrorState
              title={t("tasks.history.loadError")}
              retryLabel={t("common.retry")}
              onRetry={() => void refetch()}
              fill
            />
          ) : entries.length === 0 ? (
            <EmptyState icon={History} title={t("tasks.history.empty")} fill />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {entries.map((entry) => (
                  <RunRow
                    key={entry.id}
                    entry={entry}
                    onDelete={() => void onDeleteOne(entry.id)}
                  />
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </Dialog>
  );
}

function parseSteps(steps: string): TaskRunStepRecord[] {
  try {
    const parsed = JSON.parse(steps);
    return Array.isArray(parsed) ? (parsed as TaskRunStepRecord[]) : [];
  } catch {
    return [];
  }
}

function RunRow({
  entry,
  onDelete,
}: {
  entry: TaskRunHistoryEntry;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const steps = useMemo(() => parseSteps(entry.steps), [entry.steps]);
  const duration = runDuration(entry);

  return (
    <li className="group">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => steps.length && setOpen((o) => !o)}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2 text-left",
            steps.length ? "cursor-pointer" : "cursor-default",
          )}
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
              !steps.length && "opacity-0",
            )}
          />
          <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-sm font-medium text-foreground"
                title={entry.taskName}
              >
                {entry.taskName}
              </span>
              <Badge variant={statusVariant[entry.status]}>
                {t(`tasks.history.status.${entry.status}`)}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
              {entry.hostLabel && (
                <MetaItem icon={Server} title={entry.hostLabel}>
                  {entry.hostLabel}
                </MetaItem>
              )}
              <MetaItem icon={ListChecks}>
                {t("tasks.history.steps", { count: entry.totalSteps })}
              </MetaItem>
              <MetaItem icon={Clock}>
                {new Date(entry.startedAt).toLocaleString()}
              </MetaItem>
              {duration && (
                <MetaItem icon={Timer}>
                  {t("tasks.history.duration", { duration })}
                </MetaItem>
              )}
            </div>
            {entry.message && (
              <span className="text-2xs text-danger">{entry.message}</span>
            )}
          </div>
        </button>
        <Tooltip content={t("tasks.history.delete")}>
          <Button
            size="icon"
            variant="ghost"
            className="history-row-action pointer-events-none -ml-3 h-6 w-0 shrink-0 overflow-hidden opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:ml-0 group-focus-within:w-6 group-focus-within:opacity-100"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </Tooltip>
      </div>

      {open && steps.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {steps.map((record, index) => (
            <StepRow key={index} record={record} />
          ))}
        </ul>
      )}
    </li>
  );
}

function StepRow({ record }: { record: TaskRunStepRecord }) {
  const { t } = useI18n();
  const meta = STEP_META[record.step.type];
  const Icon = meta.icon;
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <StepStatusIcon status={record.status} />
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 text-xs font-medium">{t(meta.labelKey)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
        {stepSummary(record.step)}
      </span>
      {record.exitCode !== undefined && record.exitCode !== 0 && (
        <span className="shrink-0 font-mono text-2xs text-danger">
          exit {record.exitCode}
        </span>
      )}
    </li>
  );
}

function StepStatusIcon({ status }: { status: TaskRunStepStatus }) {
  switch (status) {
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

function runDuration(entry: TaskRunHistoryEntry): string | null {
  if (!entry.finishedAt) return null;
  const ms =
    new Date(entry.finishedAt).getTime() - new Date(entry.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}
