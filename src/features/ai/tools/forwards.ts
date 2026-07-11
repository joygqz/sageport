import {
  CircleStop,
  Play,
  PlugZap,
  SquarePen,
  Trash2,
  Waypoints,
} from "lucide-react";

import { ipc } from "@/lib/ipc";
import type {
  ForwardKind,
  PortForward,
  PortForwardInput,
} from "@/types/models";
import { invalidateForwards } from "./cache";
import {
  bool,
  num,
  nullableNum,
  nullableStr,
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionResult,
} from "./types";

async function findForward(id: string): Promise<PortForward | undefined> {
  const forwards = await ipc.forwards.list();
  return forwards.find((f) => f.id === id);
}

async function listForwards(): Promise<ToolExecutionResult> {
  const [forwards, active] = await Promise.all([
    ipc.forwards.list(),
    ipc.forwards.active(),
  ]);
  if (forwards.length === 0) return toolSuccess("No port forwards saved yet.");
  const activeSet = new Set(active);
  return toolSuccess(
    JSON.stringify(
      forwards.map((f) => ({
        id: f.id,
        label: f.label,
        hostId: f.hostId,
        kind: f.kind,
        bind: `${f.bindHost}:${f.bindPort}`,
        target:
          f.kind === "local" && f.targetHost
            ? `${f.targetHost}:${f.targetPort}`
            : undefined,
        active: activeSet.has(f.id),
      })),
    ),
  );
}

function inputFromArgs(
  args: Record<string, unknown>,
  base?: PortForward,
): PortForwardInput {
  const kind = (optionalStr(args, "kind") ??
    base?.kind ??
    "local") as ForwardKind;
  const targetHost = nullableStr(args, "targetHost");
  const targetPort = nullableNum(args, "targetPort");
  return {
    hostId: optionalStr(args, "hostId") ?? base?.hostId ?? "",
    label: optionalStr(args, "label") ?? base?.label ?? "",
    kind,
    bindHost: optionalStr(args, "bindHost") ?? base?.bindHost,
    bindPort: num(args, "bindPort") ?? base?.bindPort ?? 0,
    targetHost:
      targetHost === undefined ? (base?.targetHost ?? null) : targetHost,
    targetPort:
      targetPort === undefined ? (base?.targetPort ?? null) : targetPort,
    autoStart:
      "autoStart" in args ? bool(args, "autoStart") : Boolean(base?.autoStart),
  };
}

async function createForward(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const hostId = optionalStr(args, "hostId");
  const label = optionalStr(args, "label");
  const bindPort = num(args, "bindPort");
  if (!hostId || !label || !bindPort) {
    return toolFailure("Error: hostId, label, and bindPort are required.");
  }
  const kind = optionalStr(args, "kind") ?? "local";
  if (
    kind === "local" &&
    (!optionalStr(args, "targetHost") || !num(args, "targetPort"))
  ) {
    return toolFailure(
      "Error: a local forward needs targetHost and targetPort.",
    );
  }
  const forward = await ipc.forwards.create(inputFromArgs(args));
  invalidateForwards();
  return toolSuccess(`Created forward "${forward.label}". id: ${forward.id}`);
}

async function updateForward(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no forward id given.");
  const current = await findForward(id);
  if (!current) return toolFailure(`Error: no forward with id "${id}".`);
  const forward = await ipc.forwards.update(id, inputFromArgs(args, current));
  invalidateForwards();
  return toolSuccess(`Updated forward "${forward.label}".`);
}

async function startForward(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no forward id given.");
  try {
    await ipc.forwards.start(id);
  } catch {
    return toolFailure(`Error: could not start forward "${id}".`);
  }
  return toolSuccess(`Started forward ${id}.`);
}

async function stopForward(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no forward id given.");
  try {
    await ipc.forwards.stop(id);
  } catch {
    return toolFailure(`Error: could not stop forward "${id}".`);
  }
  return toolSuccess(`Stopped forward ${id}.`);
}

async function deleteForward(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no forward id given.");
  try {
    await ipc.forwards.remove(id);
  } catch {
    return toolFailure(`Error: could not delete forward "${id}".`);
  }
  invalidateForwards();
  return toolSuccess(`Deleted forward ${id}.`);
}

const FORWARD_FIELDS = {
  hostId: { type: "string", description: "Host id from list_hosts." },
  label: { type: "string", description: "Display name." },
  kind: {
    type: "string",
    enum: ["local", "dynamic"],
    description: "'local' (fixed target) or 'dynamic' (SOCKS proxy).",
  },
  bindHost: {
    type: "string",
    description: "Local bind address (default 127.0.0.1).",
  },
  bindPort: { type: "integer", description: "Local port to listen on." },
  targetHost: {
    type: ["string", "null"],
    description:
      "Remote host to reach (local forwards only). Set null to clear it.",
  },
  targetPort: {
    type: ["integer", "null"],
    description: "Remote port (local forwards only). Set null to clear it.",
  },
  autoStart: {
    type: "boolean",
    description: "Start automatically when the host connects.",
  },
} as const;

const byId = {
  type: "object" as const,
  properties: { id: { type: "string", description: "Forward id." } },
  required: ["id"],
  additionalProperties: false,
};

export const forwardTools: AiTool[] = [
  {
    spec: {
      name: "list_forwards",
      description:
        "List saved port forwards with their bind/target and whether each is currently active.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Waypoints,
    labelKey: "ai.tool.listForwards",
    execute: async () => listForwards(),
  },
  {
    spec: {
      name: "create_forward",
      description:
        "Create a port forward. Local forwards need targetHost and targetPort; dynamic forwards act as a SOCKS proxy on bindPort.",
      parameters: {
        type: "object",
        properties: FORWARD_FIELDS,
        required: ["hostId", "label", "kind", "bindPort"],
        additionalProperties: false,
      },
    },
    icon: PlugZap,
    labelKey: "ai.tool.createForward",
    requiresApproval: true,
    execute: async (args) => createForward(args),
  },
  {
    spec: {
      name: "update_forward",
      description:
        "Update a saved forward. Only the given fields change; others are kept.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, ...FORWARD_FIELDS },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateForward",
    requiresApproval: true,
    execute: async (args) => updateForward(args),
  },
  {
    spec: {
      name: "start_forward",
      description: "Start a saved port forward by id.",
      parameters: byId,
    },
    icon: Play,
    labelKey: "ai.tool.startForward",
    requiresApproval: true,
    execute: async (args) => startForward(args),
  },
  {
    spec: {
      name: "stop_forward",
      description: "Stop a running port forward by id.",
      parameters: byId,
    },
    icon: CircleStop,
    labelKey: "ai.tool.stopForward",
    requiresApproval: true,
    execute: async (args) => stopForward(args),
  },
  {
    spec: {
      name: "delete_forward",
      description: "Delete a saved port forward by id.",
      parameters: byId,
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteForward",
    requiresApproval: true,
    execute: async (args) => deleteForward(args),
  },
];
