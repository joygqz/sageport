import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, X } from "lucide-react";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  Input,
  INTERACTIVE_FOCUS_CLASS,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { TaskStep } from "@/types/models";
import { MAX_STEP_RETRIES, STEP_META, stepSummary } from "./steps";

interface TaskStepCardProps {
  step: TaskStep;
  index: number;
  total: number;
  defaultOpen?: boolean;
  autoScroll?: boolean;
  disabled?: boolean;
  onChange: (step: TaskStep) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function TaskStepCard({
  step,
  index,
  total,
  defaultOpen = false,
  autoScroll = false,
  disabled,
  onChange,
  onRemove,
  onMove,
}: TaskStepCardProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const cardRef = useRef<HTMLDivElement>(null);
  const meta = STEP_META[step.type];
  const Icon = meta.icon;
  const summary = stepSummary(step);

  useEffect(() => {
    if (autoScroll) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [autoScroll]);

  return (
    <Collapsible ref={cardRef} open={open} onOpenChange={setOpen}>
      <div className="group flex items-center gap-1 px-2 py-1.5">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              INTERACTIVE_FOCUS_CLASS,
              "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1",
            )}
          >
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                !open && "-rotate-90",
              )}
            />
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-2xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <Icon
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.7}
            />
            <span className="shrink-0 text-sm font-medium">
              {t(meta.labelKey)}
            </span>
            {!open && (
              <span className="min-w-0 flex-1 truncate text-left font-mono text-2xs text-muted-foreground">
                {summary}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip content={t("tasks.form.moveUp")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              disabled={disabled || index === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t("tasks.form.moveDown")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              disabled={disabled || index === total - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t("tasks.form.removeStep")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground hover:text-danger"
              disabled={disabled}
              onClick={onRemove}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <StepFields step={step} disabled={disabled} onChange={onChange} />

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("tasks.form.retries")}</span>
            <RetryStepper
              value={step.retries ?? 0}
              disabled={disabled}
              onChange={(retries) => onChange({ ...step, retries })}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RetryStepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const clamp = (next: number) =>
    onChange(Math.min(MAX_STEP_RETRIES, Math.max(0, next)));
  return (
    <div className="flex items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={disabled || value <= 0}
        onClick={() => clamp(value - 1)}
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="w-5 text-center font-mono text-sm tabular-nums text-foreground">
        {value}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={disabled || value >= MAX_STEP_RETRIES}
        onClick={() => clamp(value + 1)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

function StepFields({
  step,
  disabled,
  onChange,
}: {
  step: TaskStep;
  disabled?: boolean;
  onChange: (step: TaskStep) => void;
}) {
  const { t } = useI18n();
  const inputClass = "font-mono text-xs";

  switch (step.type) {
    case "localCommand":
    case "remoteCommand":
      return (
        <>
          <Field label={t("tasks.form.workingDir")}>
            <Input
              value={step.cwd ?? ""}
              disabled={disabled}
              placeholder={t("tasks.form.workingDirPlaceholder")}
              className={inputClass}
              maxLength={4 * 1024}
              onChange={(e) => onChange({ ...step, cwd: e.target.value })}
            />
          </Field>
          <Field label={t("tasks.form.command")} required>
            <Textarea
              rows={2}
              value={step.command}
              disabled={disabled}
              placeholder={
                step.type === "localCommand"
                  ? t("tasks.form.localCommandPlaceholder")
                  : t("tasks.form.remoteCommandPlaceholder")
              }
              className={cn(inputClass)}
              maxLength={32 * 1024}
              onChange={(e) => onChange({ ...step, command: e.target.value })}
            />
          </Field>
        </>
      );
    case "upload":
      return (
        <>
          <Field label={t("tasks.form.localSource")} required>
            <Input
              value={step.localPath}
              disabled={disabled}
              placeholder="./dist"
              className={inputClass}
              maxLength={4 * 1024}
              onChange={(e) => onChange({ ...step, localPath: e.target.value })}
            />
          </Field>
          <Field label={t("tasks.form.remoteDest")} required>
            <Input
              value={step.remotePath}
              disabled={disabled}
              placeholder="/var/www/app"
              className={inputClass}
              maxLength={4 * 1024}
              onChange={(e) =>
                onChange({ ...step, remotePath: e.target.value })
              }
            />
          </Field>
        </>
      );
    case "download":
      return (
        <>
          <Field label={t("tasks.form.remoteSource")} required>
            <Input
              value={step.remotePath}
              disabled={disabled}
              placeholder="/tmp/backup.tar.gz"
              className={inputClass}
              maxLength={4 * 1024}
              onChange={(e) =>
                onChange({ ...step, remotePath: e.target.value })
              }
            />
          </Field>
          <Field label={t("tasks.form.localDest")} required>
            <Input
              value={step.localPath}
              disabled={disabled}
              placeholder="~/backups/backup.tar.gz"
              className={inputClass}
              maxLength={4 * 1024}
              onChange={(e) => onChange({ ...step, localPath: e.target.value })}
            />
          </Field>
        </>
      );
  }
}
