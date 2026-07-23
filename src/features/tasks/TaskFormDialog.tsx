import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Info, Plus } from "lucide-react";

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
  SegmentedControl,
  Select,
  Tooltip,
} from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { Task, TaskStep } from "@/types/models";
import { parseTaskSteps, useCreateTask, useUpdateTask } from "./api";
import { STEP_META, STEP_TYPES, newStep, taskVariables } from "./steps";
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

const PICKER_ROW_CLASS = cn(
  INTERACTIVE_FOCUS_CLASS,
  "flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-ring/60 hover:bg-list-hover",
);

function TemplatePicker({ onPick }: { onPick: (draft: TaskDraft) => void }) {
  const { t } = useI18n();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <button
        type="button"
        autoFocus
        onClick={() => onPick({ name: "", steps: [newStep("localCommand")] })}
        className={cn(PICKER_ROW_CLASS, "border-dashed")}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-link">
          <Plus className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("tasks.blank")}</p>
          <p className="truncate text-2xs text-muted-foreground">
            {t("tasks.blankHint")}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <div className="flex flex-col gap-2">
        <p className="text-2xs font-medium text-muted-foreground">
          {t("tasks.templateLabel")}
        </p>
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
              className={PICKER_ROW_CLASS}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                <Icon className="size-4" strokeWidth={1.7} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(template.nameKey)}</p>
                <p className="truncate text-2xs text-muted-foreground">
                  {t(template.summaryKey)}
                </p>
              </div>
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {t("tasks.templateSteps", { count: template.steps.length })}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
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
  const [target, setTarget] = useState<"fixed" | "runtime">(
    task?.hostId ? "fixed" : "runtime",
  );
  const [hostId, setHostId] = useState(task?.hostId ?? "");
  const [steps, setSteps] = useState<TaskStep[]>(draft.steps);

  const variables = useMemo(() => taskVariables(steps), [steps]);

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

    const input = {
      name: name.trim(),
      description: description.trim() || null,
      hostId: target === "fixed" ? hostId || null : null,
      steps,
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

      <Field label={t("tasks.form.target")}>
        <div className="flex flex-col gap-2">
          <SegmentedControl
            value={target}
            onChange={setTarget}
            options={[
              { value: "fixed", label: t("tasks.form.targetFixed") },
              { value: "runtime", label: t("tasks.form.targetRuntime") },
            ]}
          />
          {target === "fixed" && (
            <Select
              value={hostId}
              onValueChange={setHostId}
              placeholder={t("tasks.form.selectHost")}
              options={hosts.map((host) => ({
                value: host.id,
                label: host.label,
              }))}
            />
          )}
        </div>
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {t("tasks.form.steps")}
        </span>
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
                <DropdownMenuItem key={type} onSelect={() => addStep(type)}>
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
            onChange={(next) => updateStep(index, next)}
            onRemove={() => removeStep(index)}
            onMove={(direction) => moveStep(index, direction)}
          />
        ))}
      </div>

      {variables.length > 0 && (
        <div className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t("tasks.form.variablesHint", {
              names: variables.map((v) => v.name).join(", "),
            })}
          </span>
        </div>
      )}
    </FormBody>
  );
}
