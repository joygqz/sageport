import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage } from "@/lib/toast";
import type { Task, TaskRunEvent, TaskStep } from "@/types/models";
import { parseTaskSteps } from "./api";

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
  steps: TaskStep[];
  stepStates: StepRunState[];
  status: RunStatus;
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
  startRun: (
    task: Task,
    hostId: string,
    variables: Record<string, string>,
  ) => StartedRun;
  cancelRun: (requestId: string) => void;
  dismissRun: (requestId: string) => void;
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

  const ensureTransferBridge = () => {
    if (transferBridged) return;
    transferBridged = true;
    void ipc.sftp.onTransfer((event) => {
      const runs = get().runs;
      for (const run of Object.values(runs)) {
        const prefix = `${run.requestId}-s`;
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

    startRun: (task, hostId, variables) => {
      ensureTransferBridge();
      const requestId = crypto.randomUUID();
      const steps = parseTaskSteps(task);
      const run: TaskRun = {
        requestId,
        taskId: task.id,
        taskName: task.name,
        hostId,
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
          finalize(
            requestId,
            errorCode(err) === "cancelled" ? "cancelled" : "error",
          );
          const current = get().runs[requestId];
          if (current && errorCode(err) !== "cancelled") {
            const firstPending = current.stepStates.findIndex(
              (step) => step.status === "pending" || step.status === "running",
            );
            if (firstPending >= 0) {
              patchStep(requestId, firstPending, {
                status: "error",
                message: errorMessage(err),
              });
            }
          }
        }
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
        return { runs: rest };
      }),
  };
});
