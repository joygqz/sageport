import type { TFunction } from "@/i18n";
import { nextCronTime } from "@/lib/cron";
import type { Task, TrayTaskItem } from "@/types/models";

const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * Build the ordered tray rows for tasks that run on a schedule, each labeled with
 * its next run time and sorted soonest-first. Tasks whose cron never fires again
 * are dropped. The webview owns this because it has the cron next-run times and
 * the current UI language together.
 */
export function scheduledTaskItems(
  tasks: Task[],
  now: Date,
  t: TFunction,
  locale: string,
): TrayTaskItem[] {
  const rows: { id: string; label: string; at: number }[] = [];
  for (const task of tasks) {
    if (!task.scheduleEnabled || !task.schedule) continue;
    const next = nextCronTime(task.schedule, now);
    if (!next) continue;
    const label = `${task.name} · ${t("tasks.schedule.nextShort", {
      time: next.toLocaleString(locale, NEXT_RUN_FORMAT),
    })}`;
    rows.push({ id: task.id, label, at: next.getTime() });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows.map(({ id, label }) => ({ id, label }));
}
