import { useEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import { nextCronTime } from "@/lib/cron";
import { ipc } from "@/lib/ipc";
import type { Task, TrayMenuData, TrayTaskItem } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { useTasks } from "./api";
import { useTaskFocusStore } from "./focus";

// Match the scheduler's cadence so tray next-run times refresh shortly after a
// task fires and its baseline advances.
const TICK_MS = 30 * 1000;

const NEXT_RUN_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/**
 * Build the ordered tray rows for tasks that run on a schedule, each labeled with
 * its next run time and sorted soonest-first. Tasks whose cron never fires again
 * are dropped.
 */
function scheduledItems(
  tasks: Task[],
  now: Date,
  label: (name: string, next: Date) => string,
): TrayTaskItem[] {
  const rows: { id: string; label: string; at: number }[] = [];
  for (const task of tasks) {
    if (!task.scheduleEnabled || !task.schedule) continue;
    const next = nextCronTime(task.schedule, now);
    if (!next) continue;
    rows.push({ id: task.id, label: label(task.name, next), at: next.getTime() });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows.map(({ id, label }) => ({ id, label }));
}

/**
 * Keep the system-tray menu in sync with the scheduled tasks and route tray
 * clicks back into the app. The webview is the only place that has the task list,
 * cron next-run times, and current UI language together, so it computes the whole
 * menu payload and pushes it to the Rust tray, which just lays it out.
 */
export function useTrayMenu(): void {
  const { t, locale } = useI18n();
  const { data: tasks = [] } = useTasks();
  const lastPushed = useRef<string | null>(null);

  useEffect(() => {
    const push = () => {
      const items = scheduledItems(tasks, new Date(), (name, next) =>
        `${name} · ${t("tasks.schedule.nextShort", {
          time: next.toLocaleString(locale, NEXT_RUN_FORMAT),
        })}`,
      );
      const data: TrayMenuData = {
        openLabel: t("tray.open"),
        quitLabel: t("tray.quit"),
        sectionLabel: t("tray.section"),
        emptyLabel: t("tray.empty"),
        tasks: items,
      };
      const sig = JSON.stringify(data);
      if (sig === lastPushed.current) return;
      lastPushed.current = sig;
      void ipc.tray.setTasks(data).catch(() => {
        // A failed push only leaves the tray one tick stale; the next tick retries.
        lastPushed.current = null;
      });
    };

    push();
    const timer = window.setInterval(push, TICK_MS);
    return () => window.clearInterval(timer);
  }, [tasks, t, locale]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void ipc.tray
      .onOpenTask((taskId) => {
        // Reveal the Tasks view without the same-activity toggle hiding the sidebar.
        const layout = useLayoutStore.getState();
        if (layout.activity !== "tasks") layout.selectActivity("tasks");
        else if (!layout.sidebarVisible) layout.toggleSidebar();
        useTaskFocusStore.getState().focus(taskId);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
