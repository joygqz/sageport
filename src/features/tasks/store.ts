import { create } from "zustand";

import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type { Task, TaskRunEvent, TaskStep } from "@/types/models";
import { parseTaskSteps } from "./api";

function t(
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
): string {
  return translate(detectLocale(), key, params);
}

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface StepRunState {
  status: StepStatus;
  log: string;
  exitCode?: number;
  message?: string;
  transferred?: number;
  total?: number;
}

export interface TaskRun {
  requestId: string;
  taskId: string;
  taskName: string;
  hostId: string;
  variables: Record<string, string>;
  steps: TaskStep[];
  stepStates: StepRunState[];
  status: RunStatus;
  /** Run-level failure (e.g. the host connection) that is not any one step's fault. */
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const MAX_STEP_LOG = 200 * 1024;

function appendLog(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_STEP_LOG
    ? combined.slice(combined.length - MAX_STEP_LOG)
    : combined;
}

export interface StartedRun {
  requestId: string;
  completion: Promise<TaskRun | undefined>;
}

interface TaskRunState {
  runs: Record<string, TaskRun>;
  /** requestId of the run currently shown in an open run dialog, if any. */
  attachedId: string | null;
  startRun: (
    task: Task,
    hostId: string,
    variables: Record<string, string>,
  ) => StartedRun;
  cancelRun: (requestId: string) => void;
  dismissRun: (requestId: string) => void;
  attach: (requestId: string) => void;
  detach: (requestId: string) => void;
}

/** The in-flight run for a task, if one is currently executing. */
export function selectRunningRunForTask(
  runs: Record<string, TaskRun>,
  taskId: string,
): TaskRun | undefined {
  return Object.values(runs).find(
    (run) => run.taskId === taskId && run.status === "running",
  );
}

let transferBridged = false;

export const useTaskRunStore = create<TaskRunState>((set, get) => {
  const patchStep = (
    requestId: string,
    index: number,
    patch:
      Partial<StepRunState> | ((step: StepRunState) => Partial<StepRunState>),
  ) =>
    set((state) => {
      const run = state.runs[requestId];
      if (!run || index < 0 || index >= run.stepStates.length) return state;
      const current = run.stepStates[index];
      const stepStates = run.stepStates.map((step, i) =>
        i === index
          ? {
              ...current,
              ...(typeof patch === "function" ? patch(current) : patch),
            }
          : step,
      );
      return { runs: { ...state.runs, [requestId]: { ...run, stepStates } } };
    });

  const applyEvent = (requestId: string, event: TaskRunEvent) => {
    switch (event.status) {
      case "start":
        patchStep(requestId, event.stepIndex, { status: "running" });
        break;
      case "log":
        if (event.chunk) {
          patchStep(requestId, event.stepIndex, (step) => ({
            log: appendLog(step.log, event.chunk ?? ""),
          }));
        }
        break;
      case "done":
        patchStep(requestId, event.stepIndex, {
          status: "done",
          exitCode: event.exitCode,
        });
        break;
      case "error":
        patchStep(requestId, event.stepIndex, {
          status: "error",
          exitCode: event.exitCode,
          message: event.message,
        });
        break;
      case "skipped":
        patchStep(requestId, event.stepIndex, { status: "skipped" });
        break;
    }
  };

  const finalize = (requestId: string, status: RunStatus) =>
    set((state) => {
      const run = state.runs[requestId];
      if (!run) return state;
      const resolved: RunStatus =
        status === "cancelled"
          ? "cancelled"
          : run.stepStates.some((step) => step.status === "error")
            ? "error"
            : status;
      return {
        runs: {
          ...state.runs,
          [requestId]: { ...run, status: resolved, finishedAt: Date.now() },
        },
      };
    });

  // Record a run-level failure and mark the steps that never got to run as
  // skipped — a connection failure happens before any step, so pinning it to the
  // first step would wrongly blame it (e.g. a local build command).
  const failRun = (requestId: string, message: string) =>
    set((state) => {
      const run = state.runs[requestId];
      if (!run) return state;
      const stepStates = run.stepStates.map((step) =>
        step.status === "pending" || step.status === "running"
          ? { ...step, status: "skipped" as const }
          : step,
      );
      return {
        runs: {
          ...state.runs,
          [requestId]: { ...run, stepStates, error: message },
        },
      };
    });

  // A run that finished while no dialog was watching it (backgrounded) reports
  // its outcome via a toast and is then dropped, so the store never accumulates
  // stale finished runs. When a dialog is attached it shows the result inline and
  // owns cleanup on close, so stay quiet here.
  const reportBackgroundCompletion = (requestId: string) => {
    const state = get();
    if (state.attachedId === requestId) return;
    const run = state.runs[requestId];
    if (!run) return;
    if (run.status === "done") {
      toast.success(t("tasks.run.doneToast", { name: run.taskName }));
    } else if (run.status === "error") {
      toast.error(t("tasks.run.errorToast", { name: run.taskName }), run.error);
    }
    get().dismissRun(requestId);
  };

  const ensureTransferBridge = () => {
    if (transferBridged) return;
    transferBridged = true;
    void ipc.sftp.onTransfer((event) => {
      const runs = get().runs;
      for (const run of Object.values(runs)) {
        const prefix = `task:${run.requestId}-s`;
        if (!event.transferId.startsWith(prefix)) continue;
        const index = Number.parseInt(
          event.transferId.slice(prefix.length),
          10,
        );
        if (Number.isNaN(index)) continue;
        patchStep(run.requestId, index, {
          transferred: event.transferred,
          total: event.total,
        });
        return;
      }
    });
  };

  return {
    runs: {},
    attachedId: null,

    startRun: (task, hostId, variables) => {
      ensureTransferBridge();
      const requestId = crypto.randomUUID();
      const steps = parseTaskSteps(task);
      const run: TaskRun = {
        requestId,
        taskId: task.id,
        taskName: task.name,
        hostId,
        variables,
        steps,
        stepStates: steps.map(() => ({ status: "pending", log: "" })),
        status: "running",
        startedAt: Date.now(),
      };
      set((state) => ({ runs: { ...state.runs, [requestId]: run } }));

      const completion = (async () => {
        try {
          await ipc.tasks.run(
            task.id,
            hostId,
            variables,
            (event) => applyEvent(requestId, event),
            requestId,
          );
          finalize(requestId, "done");
        } catch (err) {
          const cancelled = errorCode(err) === "cancelled";
          // Only connection/setup failures (before any step) and cancellation reject
          // here — a failing step reports itself over the event channel and resolves
          // normally, so this error belongs to the run, not to a step.
          if (!cancelled) failRun(requestId, errorMessage(err));
          finalize(requestId, cancelled ? "cancelled" : "error");
        }
        reportBackgroundCompletion(requestId);
        return get().runs[requestId];
      })();

      return { requestId, completion };
    },

    cancelRun: (requestId) => {
      void ipc.tasks.cancelRun(requestId).catch(() => {});
    },

    dismissRun: (requestId) =>
      set((state) => {
        const rest = { ...state.runs };
        delete rest[requestId];
        return {
          runs: rest,
          attachedId: state.attachedId === requestId ? null : state.attachedId,
        };
      }),

    attach: (requestId) => set({ attachedId: requestId }),

    detach: (requestId) =>
      set((state) =>
        state.attachedId === requestId ? { attachedId: null } : state,
      ),
  };
});
