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

const TICK_MS = 30 * 1000;

function revealActivity(activity: Activity): void {
  const layout = useLayoutStore.getState();
  if (layout.activity !== activity) layout.selectActivity(activity);
  else if (!layout.sidebarVisible) layout.toggleSidebar();
}

export function useTrayMenu(): void {
  const { t, locale } = useI18n();
  const { data: tasks = [] } = useTasks();
  const { data: forwards = [] } = useForwards();
  const runtime = useForwardStore((s) => s.runtime);
  const lastPushed = useRef<string | null>(null);

  useEffect(() => {
    void bridgeForwardEvents().catch(() => {});
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
