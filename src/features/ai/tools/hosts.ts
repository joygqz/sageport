import {
  Activity,
  FolderInput,
  FolderTree,
  Import,
  Plug,
  Server,
  ServerCog,
  SquarePen,
  Terminal as TerminalIcon,
  Trash2,
} from "lucide-react";

import { ipc } from "@/lib/ipc";
import type {
  BatchExecEvent,
  Host,
  HostHealthCheck,
  HostInput,
} from "@/types/models";
import {
  terminalTabs,
  useTabsStore,
  type TerminalStatus,
  type TerminalTab,
} from "@/workbench/tabs";
import { invalidateHosts } from "./cache";
import { sleep } from "./terminal";
import {
  num,
  nullableStr,
  optionalStr,
  str,
  strArray,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

export function reusableHostSession(
  tabs: Parameters<typeof terminalTabs>[0],
  hostId: string,
): TerminalTab | undefined {
  const priority: Record<TerminalStatus, number> = {
    connected: 0,
    connecting: 1,
    idle: 2,
    closed: 3,
    error: 4,
  };
  return terminalTabs(tabs)
    .filter((tab) => tab.hostId === hostId)
    .sort((a, b) => priority[a.status] - priority[b.status])[0];
}

async function waitForConnection(
  id: string,
  timeoutMs: number,
  isCancelled: () => boolean = () => false,
): Promise<TerminalStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = terminalTabs(useTabsStore.getState().tabs).find(
      (t) => t.id === id,
    );
    if (!tab) return "closed";
    if (isCancelled()) return tab.status;
    if (tab.status !== "connecting" && tab.status !== "idle") {
      return tab.status;
    }
    await sleep(250);
  }
  return "connecting";
}

async function listHosts(): Promise<ToolExecutionResult> {
  const [hosts, groups] = await Promise.all([
    ipc.hosts.list(),
    ipc.groups.list(),
  ]);
  if (hosts.length === 0) {
    return toolSuccess(
      "No saved hosts yet. The user can add one in the Hosts view.",
    );
  }
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  return toolSuccess(
    JSON.stringify(
      hosts.map((h) => {
        const notes = h.notes?.trim();
        return {
          id: h.id,
          label: h.label,
          address: h.address,
          port: h.port,
          username: h.username || undefined,
          group: h.groupId ? groupNames.get(h.groupId) : undefined,
          notes: notes ? notes.slice(0, 200) : undefined,
        };
      }),
    ),
  );
}

async function listGroups(): Promise<ToolExecutionResult> {
  const groups = await ipc.groups.list();
  if (groups.length === 0) {
    return toolSuccess("No host groups yet.");
  }
  return toolSuccess(
    JSON.stringify(
      groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parentId })),
    ),
  );
}

async function connectHost(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const hostId = str(args, "hostId");
  if (!hostId) return toolFailure("Error: no hostId given.");

  let host;
  try {
    host = await ipc.hosts.get(hostId);
  } catch {
    return toolFailure(
      `Error: no saved host with id "${hostId}". Call list_hosts to see valid ids.`,
    );
  }

  const state = useTabsStore.getState();
  const existing = reusableHostSession(state.tabs, hostId);
  if (existing?.status === "connected") {
    state.setActive(existing.id);
    return toolSuccess(
      `Already connected to "${host.label}". sessionId: ${existing.id}`,
    );
  }

  const id =
    existing?.id ?? state.openTerminal({ id: host.id, label: host.label });
  if (!id) {
    return toolFailure(
      `Error: the terminal tab limit has been reached. Close a terminal session before connecting to "${host.label}".`,
    );
  }
  if (existing) {
    state.setActive(existing.id);
    if (existing.status === "closed" || existing.status === "error") {
      state.reconnectTerminal(existing.id);
    }
  }

  const status = await waitForConnection(id, 30_000, context.isCancelled);
  if (context.isCancelled?.()) {
    return toolFailure(
      `Error: the assistant run was stopped while connecting to "${host.label}". The terminal tab may still be open.`,
    );
  }
  if (status === "connected") {
    return toolSuccess(`Connected to "${host.label}". sessionId: ${id}`);
  }
  if (status === "connecting" || status === "idle") {
    return toolSuccess(
      `Still connecting to "${host.label}" (sessionId: ${id}). The user may need to answer a prompt in the terminal tab (host key trust, password). Check again later with list_terminal_sessions or read_terminal_output.`,
    );
  }
  const tab = terminalTabs(useTabsStore.getState().tabs).find(
    (t) => t.id === id,
  );
  const detail = tab?.error ? `: ${tab.error}` : ".";
  return toolFailure(
    `Error: connection to "${host.label}" ${
      status === "error" ? "failed" : "was closed"
    }${detail}`,
  );
}

async function runCommandOnHosts(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const hostIds = strArray(args, "hostIds");
  const command = str(args, "command").trim();
  if (hostIds.length === 0) {
    return toolFailure(
      "Error: no hostIds given. Call list_hosts to see valid ids.",
    );
  }
  if (!command) return toolFailure("Error: no command given.");
  if (context.isCancelled?.()) {
    return toolFailure("Error: the assistant run was stopped.");
  }

  const results = new Map<string, BatchExecEvent>();
  const requestId = crypto.randomUUID();
  let cancelInFlight = false;
  const cancelTimer = globalThis.setInterval(() => {
    if (!cancelInFlight && context.isCancelled?.()) {
      cancelInFlight = true;
      void ipc.hosts
        .cancelRun(requestId)
        .catch(() => {})
        .finally(() => {
          cancelInFlight = false;
        });
    }
  }, 50);
  try {
    await ipc.hosts.runCommand(
      hostIds,
      command,
      (event) => {
        results.set(event.hostId, event);
      },
      requestId,
    );
  } finally {
    globalThis.clearInterval(cancelTimer);
  }
  if (context.isCancelled?.()) {
    return toolFailure(
      "Error: the assistant run was stopped; commands that had already started may still have completed.",
    );
  }

  const hosts = await ipc.hosts.list();
  const label = new Map(hosts.map((h) => [h.id, h.label]));
  const lines = hostIds.map((hostId) => {
    const event = results.get(hostId);
    const name = label.get(hostId) ?? hostId;
    if (!event) return `## ${name}\n(no result)`;
    if (event.status === "error") {
      return `## ${name} — error\n${event.message ?? "failed"}`;
    }
    const exit =
      event.exitCode !== undefined ? ` (exit ${event.exitCode})` : "";
    return `## ${name}${exit}\n${(event.output ?? "").trimEnd() || "(no output)"}`;
  });
  return toolSuccess(lines.join("\n\n"));
}

async function checkHostHealth(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  if (context.isCancelled?.()) {
    return toolFailure("Error: the assistant run was stopped.");
  }
  const requested = strArray(args, "hostIds");
  const results: HostHealthCheck[] = await ipc.hosts.checkHealth(
    requested.length ? requested : undefined,
  );
  if (context.isCancelled?.()) {
    return toolFailure("Error: the assistant run was stopped.");
  }
  if (results.length === 0) return toolSuccess("No hosts to check.");
  const hosts = await ipc.hosts.list();
  const label = new Map(hosts.map((h) => [h.id, h.label]));
  return toolSuccess(
    JSON.stringify(
      results.map((r) => ({
        host: label.get(r.hostId) ?? r.hostId,
        status: r.status,
        latencyMs: r.latencyMs ?? undefined,
        error: r.errorKind ?? undefined,
      })),
    ),
  );
}

function inputFromArgs(args: Record<string, unknown>, base?: Host): HostInput {
  const groupId = nullableStr(args, "groupId");
  const identityId = nullableStr(args, "identityId");
  const username = nullableStr(args, "username");
  const notes = nullableStr(args, "notes");
  const password = nullableStr(args, "password");
  return {
    label: optionalStr(args, "label") ?? base?.label ?? "",
    address: optionalStr(args, "address") ?? base?.address ?? "",
    port: num(args, "port") ?? base?.port,
    groupId: groupId === undefined ? (base?.groupId ?? null) : groupId,
    identityId:
      identityId === undefined ? (base?.identityId ?? null) : identityId,
    username: username === undefined ? (base?.username ?? null) : username,
    authType: base?.authType ?? null,
    keyId: base?.keyId ?? null,
    osHint: base?.osHint ?? null,
    color: base?.color ?? null,
    notes: notes === undefined ? (base?.notes ?? null) : notes,
    jumpHostId: base?.jumpHostId ?? null,
    startupCommand: base?.startupCommand ?? null,
    password:
      password === undefined ? undefined : password === null ? "" : password,
  };
}

async function createHost(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const label = optionalStr(args, "label");
  const address = optionalStr(args, "address");
  const username = optionalStr(args, "username");
  const identityId = optionalStr(args, "identityId");
  if (!label || !address || (!username && !identityId)) {
    return toolFailure(
      "Error: label, address, and either username or identityId are required.",
    );
  }
  const host = await ipc.hosts.create(inputFromArgs(args));
  invalidateHosts();
  return toolSuccess(`Created host "${host.label}". id: ${host.id}`);
}

async function updateHost(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no host id given.");
  let current: Host;
  try {
    current = await ipc.hosts.get(id);
  } catch {
    return toolFailure(`Error: no saved host with id "${id}".`);
  }
  const host = await ipc.hosts.update(id, inputFromArgs(args, current));
  invalidateHosts(id);
  return toolSuccess(`Updated host "${host.label}".`);
}

async function deleteHost(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no host id given.");
  try {
    await ipc.hosts.remove(id);
  } catch {
    return toolFailure(`Error: could not delete host "${id}".`);
  }
  invalidateHosts(id);
  return toolSuccess(`Deleted host ${id}.`);
}

async function moveHost(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no host id given.");
  const groupId = optionalStr(args, "groupId") ?? null;
  try {
    const host = await ipc.hosts.move(id, groupId);
    invalidateHosts(id);
    return toolSuccess(
      groupId
        ? `Moved "${host.label}" into group ${groupId}.`
        : `Moved "${host.label}" out of any group.`,
    );
  } catch {
    return toolFailure(`Error: could not move host "${id}".`);
  }
}

async function importSshConfig(): Promise<ToolExecutionResult> {
  const preview = await ipc.hosts.importPreview();
  const importable = preview.filter(
    (host) => !host.existing && host.warnings.length === 0,
  );
  if (importable.length === 0) {
    return toolSuccess(
      "No new hosts to import — ~/.ssh/config has none, or they are all saved already.",
    );
  }
  const count = await ipc.hosts.importApply(importable);
  invalidateHosts();
  return toolSuccess(
    `Imported ${count} host(s) from ~/.ssh/config: ${importable
      .map((h) => h.alias)
      .join(", ")}`,
  );
}

const HOST_FIELDS = {
  label: { type: "string", description: "Display name." },
  address: { type: "string", description: "Hostname or IP address." },
  port: { type: "integer", description: "SSH port (default 22)." },
  username: {
    type: ["string", "null"],
    description: "Login user. Set null to clear it.",
  },
  password: {
    type: ["string", "null"],
    description: "Password, if using password auth. Set null to clear it.",
  },
  identityId: {
    type: ["string", "null"],
    description:
      "Saved identity id (from list_identities) to authenticate as. Set null to clear it.",
  },
  groupId: {
    type: ["string", "null"],
    description: "Group id from list_groups. Set null to clear it.",
  },
  notes: {
    type: ["string", "null"],
    description: "Free-form notes. Set null to clear it.",
  },
} as const;

export const hostTools: AiTool[] = [
  {
    spec: {
      name: "list_hosts",
      description:
        "List saved hosts with ids and connection details. Use when an explicitly requested host is not identified by current context.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Server,
    labelKey: "ai.tool.listHosts",
    execute: async () => listHosts(),
  },
  {
    spec: {
      name: "list_groups",
      description: "List host groups with ids and names.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: FolderTree,
    labelKey: "ai.tool.listGroups",
    execute: async () => listGroups(),
  },
  {
    spec: {
      name: "connect_host",
      description:
        "Connect a saved host by id and return its terminal session id. Reuses or reconnects an existing tab. This requires user approval in supervised mode and runs automatically in autonomous mode.",
      parameters: {
        type: "object",
        properties: {
          hostId: { type: "string", description: "Host id from list_hosts." },
        },
        required: ["hostId"],
        additionalProperties: false,
      },
    },
    icon: Plug,
    labelKey: "ai.tool.connectHost",
    requiresApproval: true,
    execute: connectHost,
  },
  {
    spec: {
      name: "run_command_on_hosts",
      description:
        "Run one command on several saved hosts at once (each in a fresh non-interactive shell) and return the combined output per host. Does not open terminal tabs. Use for fan-out checks across servers; for an interactive live session use run_terminal_command instead.",
      parameters: {
        type: "object",
        properties: {
          hostIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 100,
            description: "Host ids from list_hosts.",
          },
          command: {
            type: "string",
            minLength: 1,
            maxLength: 32 * 1024,
            description: "The command to run.",
          },
        },
        required: ["hostIds", "command"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.runCommandOnHosts",
    requiresApproval: true,
    execute: runCommandOnHosts,
  },
  {
    spec: {
      name: "check_host_health",
      description:
        "Check whether hosts are reachable (TCP connect) and report latency. Omit hostIds to check every saved host.",
      parameters: {
        type: "object",
        properties: {
          hostIds: {
            type: "array",
            items: { type: "string" },
            description: "Host ids to check. Omit to check all.",
          },
        },
        additionalProperties: false,
      },
    },
    icon: Activity,
    labelKey: "ai.tool.checkHostHealth",
    execute: checkHostHealth,
  },
  {
    spec: {
      name: "create_host",
      description: "Save a new host.",
      parameters: {
        type: "object",
        properties: HOST_FIELDS,
        required: ["label", "address"],
        additionalProperties: false,
      },
    },
    icon: ServerCog,
    labelKey: "ai.tool.createHost",
    requiresApproval: true,
    execute: async (args) => createHost(args),
  },
  {
    spec: {
      name: "update_host",
      description:
        "Update fields of a saved host. Only the given fields change; others are kept.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, ...HOST_FIELDS },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateHost",
    requiresApproval: true,
    execute: async (args) => updateHost(args),
  },
  {
    spec: {
      name: "delete_host",
      description: "Delete a saved host by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Host id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteHost",
    requiresApproval: true,
    execute: async (args) => deleteHost(args),
  },
  {
    spec: {
      name: "move_host",
      description:
        "Move a host into a group, or out of any group by omitting groupId.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Host id." },
          groupId: {
            type: "string",
            description: "Target group id from list_groups. Omit to ungroup.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: FolderInput,
    labelKey: "ai.tool.moveHost",
    requiresApproval: true,
    execute: async (args) => moveHost(args),
  },
  {
    spec: {
      name: "import_ssh_config",
      description:
        "Import hosts from the user's ~/.ssh/config that are not saved yet.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Import,
    labelKey: "ai.tool.importSshConfig",
    requiresApproval: true,
    execute: async () => importSshConfig(),
  },
];
