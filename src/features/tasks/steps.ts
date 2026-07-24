import { Download, ServerCog, SquareTerminal, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { TKey } from "@/i18n";
import type { TaskStep, TaskStepType } from "@/types/models";

export const STEP_TYPES: TaskStepType[] = [
  "localCommand",
  "upload",
  "download",
  "remoteCommand",
];

/** Upper bound on per-step retry attempts; mirrors the backend `MAX_RETRIES`. */
export const MAX_STEP_RETRIES = 10;

export const STEP_META: Record<
  TaskStepType,
  { icon: LucideIcon; labelKey: TKey }
> = {
  localCommand: { icon: SquareTerminal, labelKey: "tasks.step.localCommand" },
  upload: { icon: Upload, labelKey: "tasks.step.upload" },
  download: { icon: Download, labelKey: "tasks.step.download" },
  remoteCommand: { icon: ServerCog, labelKey: "tasks.step.remoteCommand" },
};

export function newStep(type: TaskStepType): TaskStep {
  switch (type) {
    case "localCommand":
      return { type, command: "" };
    case "remoteCommand":
      return { type, command: "" };
    case "upload":
      return { type, localPath: "", remotePath: "" };
    case "download":
      return { type, remotePath: "", localPath: "" };
  }
}

export function stepNeedsRemote(step: TaskStep): boolean {
  return step.type !== "localCommand";
}

export function taskNeedsRemote(steps: TaskStep[]): boolean {
  return steps.some(stepNeedsRemote);
}

export function stepSummary(step: TaskStep): string {
  switch (step.type) {
    case "localCommand":
    case "remoteCommand":
      return step.command.trim() || "—";
    case "upload":
      return `${step.localPath || "—"} → ${step.remotePath || "—"}`;
    case "download":
      return `${step.remotePath || "—"} → ${step.localPath || "—"}`;
  }
}
