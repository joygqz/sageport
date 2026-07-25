import { useMemo } from "react";

import { Input, INTERACTIVE_FOCUS_CLASS, SwitchField } from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { CRON_PRESETS, isValidCron, nextCronTime } from "@/lib/cron";
import { cn } from "@/lib/utils";

const PRESET_LABELS: Record<string, TKey> = {
  hourly: "tasks.schedule.preset.hourly",
  every6h: "tasks.schedule.preset.every6h",
  daily: "tasks.schedule.preset.daily",
  weekdays: "tasks.schedule.preset.weekdays",
  weekly: "tasks.schedule.preset.weekly",
  monthly: "tasks.schedule.preset.monthly",
};

export function TaskScheduleField({
  enabled,
  schedule,
  onEnabledChange,
  onScheduleChange,
}: {
  enabled: boolean;
  schedule: string;
  onEnabledChange: (enabled: boolean) => void;
  onScheduleChange: (schedule: string) => void;
}) {
  const { t } = useI18n();
  const hint = useMemo(() => {
    const trimmed = schedule.trim();
    if (!trimmed) return null;
    if (!isValidCron(trimmed)) {
      return { error: true, text: t("tasks.schedule.invalidCron") };
    }
    const next = nextCronTime(trimmed, new Date());
    return next
      ? {
          error: false,
          text: t("tasks.schedule.nextRun", { time: next.toLocaleString() }),
        }
      : { error: true, text: t("tasks.schedule.never") };
  }, [schedule, t]);

  return (
    <div className="flex flex-col gap-2">
      <SwitchField
        label={t("tasks.schedule.enable")}
        description={t("tasks.schedule.enableHint")}
        checked={enabled}
        onCheckedChange={onEnabledChange}
      />
      {enabled && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onScheduleChange(preset.expr)}
                data-active={schedule.trim() === preset.expr}
                className={cn(
                  INTERACTIVE_FOCUS_CLASS,
                  "rounded-md border border-border bg-surface px-2 py-1 text-2xs text-muted-foreground transition-colors hover:border-ring/60 hover:bg-list-hover data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[active=true]:text-link",
                )}
              >
                {t(PRESET_LABELS[preset.id])}
              </button>
            ))}
          </div>
          <Input
            value={schedule}
            onChange={(e) => onScheduleChange(e.target.value)}
            placeholder={t("tasks.schedule.cronPlaceholder")}
            spellCheck={false}
            className="font-mono"
            maxLength={256}
          />
          {hint && (
            <span
              className={cn(
                "text-2xs",
                hint.error ? "text-danger" : "text-muted-foreground",
              )}
            >
              {hint.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
