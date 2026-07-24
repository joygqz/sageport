import { useMemo, useState } from "react";
import {
  CalendarClock,
  Copy,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";

import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { nextCronTime } from "@/lib/cron";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/models";
import {
  PanelContent,
  PANEL_HEADER_ACTION_CLASS,
  PANEL_LIST_ACTION_CLASS,
  PANEL_LIST_CLASS,
  PANEL_LIST_ICON_CLASS,
  PANEL_LIST_ITEM_CLASS,
} from "@/workbench/PanelHeader";
import { SideBarView } from "@/workbench/SideBarView";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import { parseTaskSteps, useCreateTask, useDeleteTask, useTasks } from "./api";
import { stepSummary } from "./steps";
import { selectRunningRunForTask, useTaskRunStore } from "./store";
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskRunDialog } from "./TaskRunDialog";
import { TaskRunHistoryDialog } from "./TaskRunHistoryDialog";

export function TasksView() {
  const { t } = useI18n();
  const { data: tasks = [], isLoading, isError, refetch } = useTasks();
  const createTask = useCreateTask();
  const deleteTask = useDeleteTask();

  const [form, setForm] = useState<{ open: boolean; task: Task | null }>({
    open: false,
    task: null,
  });
  const [runTask, setRunTask] = useState<Task | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) =>
      [task.name, task.description ?? "", task.steps].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [query, tasks]);

  const duplicate = (task: Task) => {
    void createTask
      .mutateAsync({
        name: t("tasks.copyName", { name: task.name }),
        description: task.description,
        hostId: task.hostId,
        steps: parseTaskSteps(task),
      })
      .catch((err) =>
        toast.error(t("tasks.form.saveError"), errorMessage(err)),
      );
  };

  const requestDelete = (task: Task) => {
    setConfirmState({
      title: t("tasks.delete.title"),
      description: t("common.deleteConfirm", { name: task.name }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("tasks.delete.action"),
          variant: "destructive",
          onSelect: () =>
            void deleteTask.mutateAsync(task.id).catch((err) => {
              toast.error(t("tasks.delete.error"), errorMessage(err));
            }),
        },
      ],
    });
  };

  return (
    <SideBarView
      title={t("tasks.viewTitle")}
      actions={
        <>
          <Tooltip content={t("tasks.history.title")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("tasks.new")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => setForm({ open: true, task: null })}
            >
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        </>
      }
      topContent={
        <SideBarFilter
          itemCount={tasks.length}
          value={query}
          onChange={setQuery}
          placeholder={t("tasks.filterPlaceholder")}
        />
      }
    >
      <PanelContent className={PANEL_LIST_CLASS}>
        {isLoading ? (
          <LoadingState label={t("common.loading")} fill />
        ) : isError ? (
          <ErrorState
            title={t("common.loadError")}
            retryLabel={t("common.retry")}
            onRetry={() => void refetch()}
            fill
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title={searching ? t("tasks.noMatches") : t("tasks.empty.title")}
            description={searching ? undefined : t("tasks.empty.description")}
            action={
              !searching && (
                <Button
                  size="sm"
                  onClick={() => setForm({ open: true, task: null })}
                >
                  <Plus /> {t("tasks.new")}
                </Button>
              )
            }
            fill={!searching}
          />
        ) : (
          filtered.map((task) => {
            const steps = parseTaskSteps(task);
            const subtitle =
              task.description?.trim() ||
              steps.map((step) => stepSummary(step)).join(" · ");
            return (
              <ContextMenu key={task.id}>
                <ContextMenuTrigger asChild>
                  <div
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest("button"))
                        return;
                      setForm({ open: true, task });
                    }}
                    className={cn(PANEL_LIST_ITEM_CLASS, "cursor-pointer")}
                  >
                    <div className={PANEL_LIST_ICON_CLASS}>
                      <Workflow className="size-4" strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {task.name}
                      </p>
                      <p className="truncate text-2xs text-muted-foreground">
                        {subtitle}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <ScheduleBadge task={task} />
                      <TaskRowAction
                        task={task}
                        onOpen={() => setRunTask(task)}
                      />
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setRunTask(task)}>
                    <Play /> {t("tasks.run.run")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => setForm({ open: true, task })}
                  >
                    <Pencil /> {t("common.edit")}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => duplicate(task)}>
                    <Copy /> {t("tasks.duplicate")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    destructive
                    onSelect={() => requestDelete(task)}
                  >
                    <Trash2 /> {t("common.delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </PanelContent>

      <TaskFormDialog
        open={form.open}
        task={form.task}
        onClose={() => setForm((s) => ({ ...s, open: false }))}
      />
      <TaskRunDialog task={runTask} onClose={() => setRunTask(null)} />
      <TaskRunHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </SideBarView>
  );
}

const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function ScheduleBadge({ task }: { task: Task }) {
  const { t } = useI18n();
  if (!task.scheduleEnabled || !task.schedule) return null;
  const next = nextCronTime(task.schedule, new Date());
  if (!next) return null;
  return (
    <Tooltip
      content={t("tasks.schedule.nextRun", { time: next.toLocaleString() })}
    >
      <span className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
        <CalendarClock className="size-3" />
        {t("tasks.schedule.nextShort", {
          time: next.toLocaleString(undefined, NEXT_RUN_FORMAT),
        })}
      </span>
    </Tooltip>
  );
}

/**
 * Trailing control for a task row. When a run for the task is executing it shows
 * an always-visible progress badge (a run keeps going after its dialog closes);
 * otherwise it falls back to the hover-revealed run button. Both reopen the run
 * dialog, which reattaches to the in-flight run so it can be watched or cancelled.
 */
function TaskRowAction({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { t } = useI18n();
  const run = useTaskRunStore((s) => selectRunningRunForTask(s.runs, task.id));

  if (run) {
    const done = run.stepStates.filter((step) =>
      ["done", "error", "skipped"].includes(step.status),
    ).length;
    return (
      <Tooltip content={t("tasks.run.running")}>
        <button
          type="button"
          onClick={onOpen}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-2xs font-medium text-warning transition-colors hover:bg-list-hover"
        >
          <Loader2 className="size-3 animate-spin" />
          {done}/{run.steps.length}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={t("tasks.run.run")}>
      <button
        type="button"
        onClick={onOpen}
        className={PANEL_LIST_ACTION_CLASS}
      >
        <Play className="size-3.5" />
      </button>
    </Tooltip>
  );
}
