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

export function isTaskStep(value: unknown): value is TaskStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Record<string, unknown>;
  if (
    step.retries !== undefined &&
    (!Number.isInteger(step.retries) ||
      (step.retries as number) < 0 ||
      (step.retries as number) > MAX_STEP_RETRIES)
  )
    return false;
  const text = (field: unknown, max: number) =>
    typeof field === "string" &&
    field.trim().length > 0 &&
    !field.includes("\0") &&
    [...field].length <= max;
  switch (step.type) {
    case "localCommand":
    case "remoteCommand":
      return (
        (step.shell === undefined ||
          step.shell === null ||
          (typeof step.shell === "string" &&
            (step.type === "remoteCommand"
              ? ["sh", "bash", "zsh"]
              : ["sh", "bash", "zsh", "cmd", "powershell"]
            ).includes(step.shell))) &&
        (step.timeoutSeconds === undefined ||
          step.timeoutSeconds === null ||
          (Number.isInteger(step.timeoutSeconds) &&
            (step.timeoutSeconds as number) >= 1 &&
            (step.timeoutSeconds as number) <= 86400)) &&
        text(step.command, 32 * 1024) &&
        (step.cwd === undefined ||
          step.cwd === null ||
          text(step.cwd, 4 * 1024))
      );
    case "upload":
    case "download":
      return text(step.localPath, 4 * 1024) && text(step.remotePath, 4 * 1024);
    default:
      return false;
  }
}
