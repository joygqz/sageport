import { ChevronDown, ChevronUp, MonitorSmartphone, X } from "lucide-react";

import { Button, Field, Input, Switch, Textarea, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { TaskStep } from "@/types/models";
import { STEP_META } from "./steps";

interface TaskStepCardProps {
  step: TaskStep;
  index: number;
  total: number;
  disabled?: boolean;
  onChange: (step: TaskStep) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

export function TaskStepCard({
  step,
  index,
  total,
  disabled,
  onChange,
  onRemove,
  onMove,
}: TaskStepCardProps) {
  const { t } = useI18n();
  const meta = STEP_META[step.type];
  const Icon = meta.icon;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface/40 px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-2xs font-semibold text-accent">
          {index + 1}
        </span>
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t(meta.labelKey)}
        </span>
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

      <div className="flex flex-col gap-3 p-3">
        {step.type === "localCommand" && (
          <div className="flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-2xs text-warning">
            <MonitorSmartphone className="size-3.5 shrink-0" />
            {t("tasks.step.localHint")}
          </div>
        )}

        <StepFields step={step} disabled={disabled} onChange={onChange} />

        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("tasks.form.continueOnError")}</span>
          <Switch
            checked={step.continueOnError ?? false}
            disabled={disabled}
            onCheckedChange={(continueOnError) =>
              onChange({ ...step, continueOnError })
            }
          />
        </label>
      </div>
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
              onChange={(e) => onChange({ ...step, remotePath: e.target.value })}
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
              onChange={(e) => onChange({ ...step, remotePath: e.target.value })}
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
