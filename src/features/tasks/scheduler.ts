import { useEffect, useRef } from "react";

import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { isValidCron, nextCronTime } from "@/lib/cron";
import { toast } from "@/lib/toast";
import type { Task } from "@/types/models";
import { parseTaskSteps, useTasks } from "./api";
import { taskNeedsRemote } from "./steps";
import { selectRunningRunForTask, useTaskRunStore } from "./store";

const STORAGE_KEY = "sageport.task-schedule-runs";
const TICK_MS = 30 * 1000;

export type SkipReason = "noHost";

export interface ScheduleRunRecord {
  lastRun: string;
  sig: string;
}

export type ScheduleState = Record<string, ScheduleRunRecord>;

export interface DueResult {
  fire: Task[];
  state: ScheduleState;
  skipped: { task: Task; reason: SkipReason }[];
}

function preflightSkip(task: Task): SkipReason | null {
  if (taskNeedsRemote(parseTaskSteps(task)) && !task.hostId) return "noHost";
  return null;
}

export function dueTasks(
  now: Date,
  tasks: Task[],
  previous: ScheduleState,
  isRunning: (taskId: string) => boolean,
): DueResult {
  const nowIso = now.toISOString();
  const state: ScheduleState = {};
  const fire: Task[] = [];
  const skipped: { task: Task; reason: SkipReason }[] = [];

  for (const task of tasks) {
    if (
      !task.scheduleEnabled ||
      !task.schedule ||
      !isValidCron(task.schedule)
    ) {
      continue;
    }
    const sig = task.schedule;
    const prev = previous[task.id];
    if (!prev || prev.sig !== sig) {
      state[task.id] = { lastRun: nowIso, sig };
      continue;
    }

    const next = nextCronTime(sig, new Date(prev.lastRun));
    if (!next || next.getTime() > now.getTime()) {
      state[task.id] = prev;
      continue;
    }
    if (isRunning(task.id)) {
      state[task.id] = prev;
      continue;
    }
    const skip = preflightSkip(task);
    if (skip) {
      skipped.push({ task, reason: skip });
      state[task.id] = { lastRun: nowIso, sig };
      continue;
    }
    fire.push(task);
    state[task.id] = { lastRun: nowIso, sig };
  }

  return { fire, state, skipped };
}

function loadState(): ScheduleState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const state: ScheduleState = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as ScheduleRunRecord).lastRun === "string" &&
        typeof (value as ScheduleRunRecord).sig === "string"
      ) {
        state[id] = value as ScheduleRunRecord;
      }
    }
    return state;
  } catch {
    return {};
  }
}

function saveState(state: ScheduleState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

export function useTaskScheduler(): void {
  const { data: tasks } = useTasks();
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const loaded = tasks !== undefined;

  useEffect(() => {
    if (!loaded) return;
    const tick = () => {
      const current = tasksRef.current;
      if (!current) return;
      const runs = useTaskRunStore.getState().runs;
      const result = dueTasks(
        new Date(),
        current,
        loadState(),
        (id) => selectRunningRunForTask(runs, id) !== undefined,
      );
      saveState(result.state);

      for (const task of result.fire) {
        useTaskRunStore.getState().startRun(task, task.hostId ?? "");
      }
      for (const { task } of result.skipped) {
        toast.warning(t("tasks.schedule.skipNoHost", { name: task.name }));
      }
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, [loaded]);
}
