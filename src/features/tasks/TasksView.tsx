import { useMemo, useState } from "react";
import { Copy, Pencil, Play, Plus, Trash2, Workflow } from "lucide-react";

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
import { TaskFormDialog } from "./TaskFormDialog";
import { TaskRunDialog } from "./TaskRunDialog";

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
      .catch((err) => toast.error(t("tasks.form.saveError"), errorMessage(err)));
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
                      if ((event.target as HTMLElement).closest("button")) return;
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
                    <Tooltip content={t("tasks.run.run")}>
                      <button
                        type="button"
                        onClick={() => setRunTask(task)}
                        className={PANEL_LIST_ACTION_CLASS}
                      >
                        <Play className="size-3.5" />
                      </button>
                    </Tooltip>
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
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </SideBarView>
  );
}
