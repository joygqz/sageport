import { useEffect, useRef } from "react";

import { useForwards } from "@/features/forwards/api";
import {
  bridgeForwardEvents,
  useForwardStore,
} from "@/features/forwards/store";
import { activeForwardItems } from "@/features/forwards/tray";
import { useTasks } from "@/features/tasks/api";
import { useTaskFocusStore } from "@/features/tasks/focus";
import { scheduledTaskItems } from "@/features/tasks/tray";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import type { Activity } from "@/workbench/layout";
import { useLayoutStore } from "@/workbench/layout";
import type { TrayMenuData } from "@/types/models";

// Match the scheduler's cadence so tray next-run times refresh shortly after a
// task fires and its baseline advances.
const TICK_MS = 30 * 1000;

/** Reveal an activity without the same-activity toggle hiding the sidebar. */
function revealActivity(activity: Activity): void {
  const layout = useLayoutStore.getState();
  if (layout.activity !== activity) layout.selectActivity(activity);
  else if (!layout.sidebarVisible) layout.toggleSidebar();
}

/**
 * Keep the system-tray menu in sync with the two things worth surfacing while the
 * window is hidden — scheduled tasks and running port forwards — and route tray
 * clicks back into the app. The webview is the only place that has the task list,
 * cron next-run times, forward runtime state, and current UI language together, so
 * it computes the whole menu payload and pushes it to the Rust tray, which just
 * lays it out.
 */
export function useTrayMenu(): void {
  const { t, locale } = useI18n();
  const { data: tasks = [] } = useTasks();
  const { data: forwards = [] } = useForwards();
  const runtime = useForwardStore((s) => s.runtime);
  const lastPushed = useRef<string | null>(null);

  // Forward runtime is normally bridged by the Forwards view, but the tray needs
  // it even when that view was never opened (e.g. forwards auto-started on
  // launch). The bridge is idempotent, so establishing it here is safe.
  useEffect(() => {
    void bridgeForwardEvents().catch(() => {
      // A failed bridge just leaves the forwards section empty; not fatal.
    });
  }, []);

  useEffect(() => {
    const push = () => {
      const data: TrayMenuData = {
        openLabel: t("tray.open"),
        quitLabel: t("tray.quit"),
        sectionLabel: t("tray.section"),
        tasks: scheduledTaskItems(tasks, new Date(), t, locale),
        forwardsSectionLabel: t("tray.forwards"),
        forwards: activeForwardItems(forwards, runtime),
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
  }, [tasks, forwards, runtime, t, locale]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void ipc.tray
      .onOpenTask((taskId) => {
        revealActivity("tasks");
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void ipc.tray
      .onOpenForward(() => {
        revealActivity("forwards");
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
