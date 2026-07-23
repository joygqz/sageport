import { ListChecks, Play, Save, SquarePen, Trash2 } from "lucide-react";

import { parseTaskSteps } from "@/features/tasks/api";
import { taskNeedsRemote, taskVariables } from "@/features/tasks/steps";
import { useTaskRunStore, type TaskRun } from "@/features/tasks/store";
import { ipc } from "@/lib/ipc";
import { substitute } from "@/lib/variables";
import type { Task, TaskInput, TaskStep } from "@/types/models";
import { invalidateTasks } from "./cache";
import {
  nullableStr,
  optionalStr,
  record,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type PreparedCall,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

const STEP_LABEL: Record<TaskStep["type"], string> = {
  localCommand: "local command",
  remoteCommand: "remote command",
  upload: "upload",
  download: "download",
};

interface ResolvedRun {
  task: Task;
  hostId: string;
  hostLabel?: string;
  values: Record<string, string>;
  steps: TaskStep[];
}

async function resolveRun(
  args: Record<string, unknown>,
): Promise<ResolvedRun | { error: string }> {
  const taskId = str(args, "taskId");
  if (!taskId) return { error: "Error: no taskId given." };
  const tasks = await ipc.tasks.list();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return {
      error: `Error: no task with id "${taskId}". Call list_tasks to see valid ids.`,
    };
  }
  const steps = parseTaskSteps(task);
  const values = record(args, "values");
  const hostId = optionalStr(args, "hostId") ?? task.hostId ?? "";
  let hostLabel: string | undefined;
  if (taskNeedsRemote(steps)) {
    if (!hostId) {
      return {
        error:
          "Error: this task has remote steps and needs a target host. Pass hostId (from list_hosts).",
      };
    }
    try {
      hostLabel = (await ipc.hosts.get(hostId)).label;
    } catch {
      return { error: `Error: no host with id "${hostId}".` };
    }
  }
  return { task, hostId, hostLabel, values, steps };
}

function planLine(step: TaskStep, values: Record<string, string>): string {
  const sub = (text: string) => substitute(text, values);
  switch (step.type) {
    case "localCommand":
    case "remoteCommand": {
      const cwd = step.cwd ? ` (in ${sub(step.cwd)})` : "";
      return `${STEP_LABEL[step.type]}: ${sub(step.command)}${cwd}`;
    }
    case "upload":
      return `upload: ${sub(step.localPath)} → ${sub(step.remotePath)}`;
    case "download":
      return `download: ${sub(step.remotePath)} → ${sub(step.localPath)}`;
  }
}

function buildPlan(resolved: ResolvedRun): string {
  const header = taskNeedsRemote(resolved.steps)
    ? `Target host: ${resolved.hostLabel ?? resolved.hostId}`
    : "Runs on this machine";
  const lines = resolved.steps.map(
    (step, index) => `${index + 1}. ${planLine(step, resolved.values)}`,
  );
  return [header, ...lines].join("\n");
}

function summarizeRun(run: TaskRun): string {
  const lines = run.steps.map((step, index) => {
    const state = run.stepStates[index];
    const exit =
      state.exitCode !== undefined && state.exitCode !== 0
        ? ` (exit ${state.exitCode})`
        : "";
    const head = `${index + 1}. ${STEP_LABEL[step.type]} — ${state.status}${exit}`;
    const log = state.log.trim();
    const detail = log
      ? `\n${log.length > 800 ? `…${log.slice(-800)}` : log}`
      : state.message
        ? `\n${state.message}`
        : "";
    return head + detail;
  });
  return `Task "${run.taskName}" — ${run.status}\n\n${lines.join("\n\n")}`;
}

async function listTasks(): Promise<ToolExecutionResult> {
  const tasks = await ipc.tasks.list();
  if (tasks.length === 0) {
    return toolSuccess("No saved tasks yet.");
  }
  return toolSuccess(
    JSON.stringify(
      tasks.map((task) => {
        const steps = parseTaskSteps(task);
        return {
          id: task.id,
          name: task.name,
          description: task.description || undefined,
          defaultHostId: task.hostId ?? undefined,
          needsHost: taskNeedsRemote(steps),
          variables: taskVariables(steps).map((v) => v.name),
          steps: steps.map((step) => planLine(step, {})),
        };
      }),
    ),
  );
}

async function prepareRunTask(
  args: Record<string, unknown>,
): Promise<PreparedCall> {
  const resolved = await resolveRun(args);
  if ("error" in resolved) return { args, preflightError: resolved.error };
  return {
    args: { ...args, hostId: resolved.hostId, command: buildPlan(resolved) },
  };
}

async function runTask(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const resolved = await resolveRun(args);
  if ("error" in resolved) return toolFailure(resolved.error);
  if (context.isCancelled?.()) {
    return toolFailure("Error: the assistant run was stopped.");
  }

  const { requestId, completion } = useTaskRunStore
    .getState()
    .startRun(resolved.task, resolved.hostId, resolved.values);

  let cancelInFlight = false;
  const timer = globalThis.setInterval(() => {
    if (!cancelInFlight && context.isCancelled?.()) {
      cancelInFlight = true;
      useTaskRunStore.getState().cancelRun(requestId);
    }
  }, 100);

  let run: TaskRun | undefined;
  try {
    run = await completion;
  } finally {
    globalThis.clearInterval(timer);
  }
  if (!run) return toolFailure("Error: the task run produced no result.");
  return toolSuccess(summarizeRun(run));
}

function taskInputFromArgs(
  args: Record<string, unknown>,
  base?: Task,
): TaskInput {
  const description = nullableStr(args, "description");
  const hostId = nullableStr(args, "hostId");
  const rawSteps = args.steps;
  const steps = Array.isArray(rawSteps)
    ? (rawSteps as TaskStep[])
    : base
      ? parseTaskSteps(base)
      : [];
  return {
    name: optionalStr(args, "name") ?? base?.name ?? "",
    description:
      description === undefined ? (base?.description ?? null) : description,
    hostId: hostId === undefined ? (base?.hostId ?? null) : hostId,
    steps,
  };
}

async function saveTask(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalStr(args, "name");
  if (!name) return toolFailure("Error: name is required.");
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    return toolFailure("Error: steps must contain at least one step.");
  }
  try {
    const task = await ipc.tasks.create(taskInputFromArgs(args));
    invalidateTasks();
    return toolSuccess(`Saved task "${task.name}". id: ${task.id}`);
  } catch (err) {
    return toolFailure(`Error: could not save task. ${describe(err)}`);
  }
}

async function updateTask(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no task id given.");
  const tasks = await ipc.tasks.list();
  const current = tasks.find((t) => t.id === id);
  if (!current) return toolFailure(`Error: no task with id "${id}".`);
  try {
    const task = await ipc.tasks.update(id, taskInputFromArgs(args, current));
    invalidateTasks();
    return toolSuccess(`Updated task "${task.name}".`);
  } catch (err) {
    return toolFailure(`Error: could not update task. ${describe(err)}`);
  }
}

async function deleteTask(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no task id given.");
  try {
    await ipc.tasks.remove(id);
  } catch {
    return toolFailure(`Error: could not delete task "${id}".`);
  }
  invalidateTasks();
  return toolSuccess(`Deleted task ${id}.`);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const STEP_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 50,
  items: { type: "object" },
  description:
    "Ordered steps. Each object is exactly one of: " +
    "{type:'localCommand', command, cwd?, continueOnError?}; " +
    "{type:'remoteCommand', command, cwd?, continueOnError?}; " +
    "{type:'upload', localPath, remotePath, continueOnError?}; " +
    "{type:'download', remotePath, localPath, continueOnError?}. " +
    "Any text field may use {{name}} or {{name:default}} placeholders.",
} as const;

export const taskTools: AiTool[] = [
  {
    spec: {
      name: "list_tasks",
      description:
        "List saved automation tasks with ids, an ordered step summary, the variables they use, and their default host.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: ListChecks,
    labelKey: "ai.tool.listTasks",
    execute: async () => listTasks(),
  },
  {
    spec: {
      name: "run_task",
      description:
        "Run a saved task: it executes its ordered steps (local commands, uploads, downloads, remote commands) and stops on the first failing step. Fill any {{variable}} placeholders via values. Pass hostId to target a host when the task has remote steps and no fixed host. Always requires user approval.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task id from list_tasks." },
          hostId: {
            type: "string",
            description:
              "Target host id from list_hosts. Optional if the task has a fixed host.",
          },
          values: {
            type: "object",
            description: "Map of variable name to value for {{placeholders}}.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
    },
    icon: Play,
    labelKey: "ai.tool.runTask",
    requiresApproval: true,
    alwaysRequireApproval: true,
    untrustedResult: true,
    confirmKey: "ai.confirmRunTask",
    prepare: (args) => prepareRunTask(args),
    execute: runTask,
  },
  {
    spec: {
      name: "save_task",
      description:
        "Save a new automation task from an ordered list of steps. Use hostId for a fixed target, or omit it to choose a host at run time.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Task name." },
          description: { type: "string", description: "Optional description." },
          hostId: {
            type: "string",
            description: "Default host id, or omit to choose at run time.",
          },
          steps: STEP_SCHEMA,
        },
        required: ["name", "steps"],
        additionalProperties: false,
      },
    },
    icon: Save,
    labelKey: "ai.tool.saveTask",
    requiresApproval: true,
    execute: async (args) => saveTask(args),
  },
  {
    spec: {
      name: "update_task",
      description:
        "Update a saved task. Only the given fields change; others are kept. Passing steps replaces the whole step list.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task id." },
          name: { type: "string" },
          description: {
            type: ["string", "null"],
            description: "Set null to clear the description.",
          },
          hostId: {
            type: ["string", "null"],
            description: "Set null to choose a host at run time.",
          },
          steps: { ...STEP_SCHEMA, minItems: 1 },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateTask",
    requiresApproval: true,
    execute: async (args) => updateTask(args),
  },
  {
    spec: {
      name: "delete_task",
      description: "Delete a saved task by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Task id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteTask",
    requiresApproval: true,
    execute: async (args) => deleteTask(args),
  },
];
