import { useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FormBody,
  FormDialog,
  Input,
  INTERACTIVE_FOCUS_CLASS,
  Select,
  Tooltip,
} from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { isValidCron } from "@/lib/cron";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { Task, TaskStep, TaskStepType } from "@/types/models";
import { parseTaskSteps, useCreateTask, useUpdateTask } from "./api";
import { STEP_META, STEP_TYPES, newStep, taskNeedsRemote } from "./steps";
import { TaskScheduleField } from "./TaskScheduleField";
import { TaskStepCard } from "./TaskStepCard";
import { TASK_TEMPLATES } from "./templates";

interface TaskDraft {
  name: string;
  steps: TaskStep[];
}

export function TaskFormDialog({
  open,
  task,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(task ? { name: task.name, steps: parseTaskSteps(task) } : null);
    }
  }

  const picking = !task && !draft;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[560px]"
      title={
        task
          ? t("tasks.editTitle")
          : picking
            ? t("tasks.pickTitle")
            : t("tasks.newTitle")
      }
      leading={
        !task && draft ? (
          <Tooltip content={t("common.back")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-[var(--toolbar-control-size)] shrink-0"
              onClick={() => setDraft(null)}
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Tooltip>
        ) : undefined
      }
    >
      {draft ? (
        <TaskFormBody task={task} draft={draft} onClose={onClose} />
      ) : (
        <TemplatePicker onPick={setDraft} />
      )}
    </FormDialog>
  );
}

const PICKER_INTERACTIVE_CLASS = cn(
  INTERACTIVE_FOCUS_CLASS,
  "rounded-lg border border-border bg-surface text-left transition-colors hover:border-ring/60 hover:bg-list-hover",
);

function TemplatePicker({ onPick }: { onPick: (draft: TaskDraft) => void }) {
  const { t } = useI18n();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          autoFocus
          onClick={() => onPick({ name: "", steps: [newStep("localCommand")] })}
          className={cn(
            PICKER_INTERACTIVE_CLASS,
            "flex flex-col gap-1.5 border-dashed p-2.5",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-link">
              <Plus className="size-3.5" />
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{t("tasks.blank")}</p>
            <p className="line-clamp-2 text-2xs text-muted-foreground">
              {t("tasks.blankHint")}
            </p>
          </div>
        </button>

        {TASK_TEMPLATES.map((template) => {
          const Icon = template.icon;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() =>
                onPick({
                  name: t(template.nameKey),
                  steps: template.steps.map((step) => ({ ...step })),
                })
              }
              className={cn(
                PICKER_INTERACTIVE_CLASS,
                "flex flex-col gap-1.5 p-2.5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                  <Icon className="size-3.5" strokeWidth={1.7} />
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {t("tasks.templateSteps", { count: template.steps.length })}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {t(template.nameKey)}
                </p>
                <p className="line-clamp-2 text-2xs text-muted-foreground">
                  {t(template.summaryKey)}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TaskFormBody({
  task,
  draft,
  onClose,
}: {
  task: Task | null;
  draft: TaskDraft;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: hosts = [] } = useHosts();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(task?.description ?? "");
  const [hostId, setHostId] = useState(task?.hostId ?? "");
  const [steps, setSteps] = useState<TaskStep[]>(draft.steps);
  const [scheduleEnabled, setScheduleEnabled] = useState(
    task?.scheduleEnabled ?? false,
  );
  const [schedule, setSchedule] = useState(task?.schedule ?? "");

  const needsHost = useMemo(() => taskNeedsRemote(steps), [steps]);

  const updateStep = (index: number, next: TaskStep) =>
    setSteps((prev) => prev.map((step, i) => (i === index ? next : step)));

  const removeStep = (index: number) =>
    setSteps((prev) => prev.filter((_, i) => i !== index));

  const moveStep = (index: number, direction: -1 | 1) =>
    setSteps((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const addStep = (type: (typeof STEP_TYPES)[number]) =>
    setSteps((prev) => [...prev, newStep(type)]);

  const submit = async () => {
    if (!name.trim()) return toast.error(t("tasks.form.nameRequired"));
    if (steps.length === 0) return toast.error(t("tasks.form.stepRequired"));
    if (needsHost && !hostId) return toast.error(t("tasks.form.hostRequired"));

    const trimmedSchedule = schedule.trim();
    if (scheduleEnabled && !isValidCron(trimmedSchedule)) {
      return toast.error(t("tasks.schedule.invalidCron"));
    }

    const input = {
      name: name.trim(),
      description: description.trim() || null,
      hostId: hostId || null,
      steps,
      schedule: isValidCron(trimmedSchedule) ? trimmedSchedule : null,
      scheduleEnabled,
    };
    try {
      if (task) {
        await updateTask.mutateAsync({ id: task.id, input });
      } else {
        await createTask.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      toast.error(t("tasks.form.saveError"), errorMessage(err));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={task ? t("common.saveChanges") : t("common.create")}
      pending={createTask.isPending || updateTask.isPending}
    >
      <Field label={t("tasks.form.name")} required>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("tasks.form.namePlaceholder")}
          maxLength={255}
        />
      </Field>
      <Field label={t("tasks.form.description")}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("tasks.form.descriptionPlaceholder")}
          maxLength={4 * 1024}
        />
      </Field>

      {needsHost && (
        <Field
          label={t("tasks.form.host")}
          required
          hint={t("tasks.form.hostHint")}
        >
          <Select
            value={hostId}
            onValueChange={setHostId}
            placeholder={t("tasks.form.selectHost")}
            options={hosts.map((host) => ({
              value: host.id,
              label: host.label,
            }))}
          />
        </Field>
      )}

      <TaskScheduleField
        enabled={scheduleEnabled}
        schedule={schedule}
        onEnabledChange={setScheduleEnabled}
        onScheduleChange={setSchedule}
      />

      <StepsSection
        steps={steps}
        onAdd={addStep}
        onChange={updateStep}
        onRemove={removeStep}
        onMove={moveStep}
      />
    </FormBody>
  );
}

function StepsSection({
  steps,
  onAdd,
  onChange,
  onRemove,
  onMove,
}: {
  steps: TaskStep[];
  onAdd: (type: TaskStepType) => void;
  onChange: (index: number, step: TaskStep) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("tasks.form.steps")}
          </span>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-2xs tabular-nums text-muted-foreground">
            {steps.length}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary">
              <Plus className="size-3.5" /> {t("tasks.form.addStep")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {STEP_TYPES.map((type) => {
              const meta = STEP_META[type];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
                  <Icon /> {t(meta.labelKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-2">
        {steps.map((step, index) => (
          <TaskStepCard
            key={index}
            step={step}
            index={index}
            total={steps.length}
            onChange={(next) => onChange(index, next)}
            onRemove={() => onRemove(index)}
            onMove={(direction) => onMove(index, direction)}
          />
        ))}
      </div>
    </div>
  );
}
