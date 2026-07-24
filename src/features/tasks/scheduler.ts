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

/**
 * Decide which scheduled tasks are due at `now`, given the last-run baseline for
 * each. Pure so the catch-up, baseline-reset, and skip rules stay testable. The
 * returned `state` is the next baseline map: a task first seen (or whose cron
 * changed) is baselined to `now` without firing, and a fired or skipped task is
 * advanced to `now` so missed occurrences collapse into a single catch-up run.
 */
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
  } catch {
    // A full or unavailable localStorage only costs catch-up precision.
  }
}

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

/**
 * Fire saved tasks on their cron schedule while the app is running. Reuses the
 * task run store so scheduled runs share the exact run, retry, and background
 * completion behavior of manual and assistant-driven runs.
 */
export function useTaskScheduler(): void {
  const { data: tasks = [] } = useTasks();
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    const tick = () => {
      const runs = useTaskRunStore.getState().runs;
      const result = dueTasks(
        new Date(),
        tasksRef.current,
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
  }, []);
}
