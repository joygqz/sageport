import { ipc } from "@/lib/ipc";
import type { AiToolSpec } from "@/types/models";
import { readTerminalContext } from "@/features/terminal/registry";
import {
  targetTerminalId,
  terminalTabs,
  useTabsStore,
  type TerminalStatus,
  type TerminalTab,
} from "@/workbench/tabs";

export const AI_TOOL_SPECS: AiToolSpec[] = [
  {
    name: "list_hosts",
    description:
      "List the user's saved hosts (servers) with their id, label, address, username, group, and notes. Use this to figure out which server the user is talking about, then open a session to it with connect_host if none is open yet.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "connect_host",
    description:
      "Open a terminal session to a saved host (by id from list_hosts) and wait until it is connected, then return the session id. If a session to that host is already open it is reused instead of opening a duplicate. Use this yourself instead of asking the user to connect manually.",
    parameters: {
      type: "object",
      properties: {
        hostId: {
          type: "string",
          description: "Host id from list_hosts.",
        },
      },
      required: ["hostId"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description:
      "Ask the user to pick one of a few options, shown as clickable buttons in the chat. Use this whenever you would otherwise ask 'which one?' in plain text — e.g. which server to check, which of several fixes to apply. Keep options short (a few words each) and write them in the user's language. Do not use it for yes/no confirmation of a command; run_terminal_command already asks for approval.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to show above the options.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 6,
          description:
            "2-6 short, mutually exclusive choices. Include a broader option like 'Both' or 'All of them' when it makes sense.",
        },
      },
      required: ["question", "options"],
      additionalProperties: false,
    },
  },
  {
    name: "list_terminal_sessions",
    description:
      "List the terminal sessions (tabs) currently open, with their id, host title, connection status, and whether each is the one the user is currently looking at. Call this first if you don't already know which session id to use.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_terminal_output",
    description:
      "Read the most recent on-screen output of a terminal session, exactly as the user sees it. Use this on demand whenever you need to see current state or check the result of a command — never ask the user to paste output instead.",
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "Session id from list_terminal_sessions. Omit to use the session the user currently has focused.",
        },
        lines: {
          type: "integer",
          description:
            "How many of the most recent lines to return (default 60, max 500).",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_terminal_command",
    description:
      "Type a command into a real terminal session and press Enter, then wait for its output to settle and return it. This executes on a live remote server, so the user is always shown a confirmation and can decline before it runs.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The exact shell command to run.",
        },
        sessionId: {
          type: "string",
          description:
            "Session id from list_terminal_sessions. Omit to use the session the user currently has focused.",
        },
        timeoutMs: {
          type: "integer",
          description:
            "Max time to wait for the command's output to settle, in milliseconds (default 10000, max 30000).",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

export type AiToolName = (typeof AI_TOOL_SPECS)[number]["name"];

export const TOOLS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set([
  "run_terminal_command",
]);

export function normalizeArgs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function askUserOptions(args: Record<string, unknown>): string[] {
  if (!Array.isArray(args.options)) return [];
  return args.options
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function askUserQuestion(args: Record<string, unknown>): string {
  return typeof args.question === "string" ? args.question.trim() : "";
}

export function selectionResult(option: string): string {
  return `The user selected: ${option}`;
}

export function resolveTerminalTab(requested?: string): TerminalTab | null {
  const state = useTabsStore.getState();
  const sessions = terminalTabs(state.tabs);
  if (requested) {
    return sessions.find((s) => s.id === requested) ?? null;
  }
  const id = targetTerminalId(state);
  return sessions.find((s) => s.id === id) ?? null;
}

export function noTerminalSessionError(requested?: string): string {
  return requested
    ? `Error: no terminal session with id "${requested}". Call list_terminal_sessions to see valid ids.`
    : "Error: no active terminal session. Call list_terminal_sessions to pick one, or connect_host to open one.";
}

export function sessionNotConnectedError(tab: TerminalTab): string {
  return `Error: terminal session "${tab.title}" (${tab.id}) is not connected (status: ${tab.status}). Reconnect it with connect_host or pick a connected session from list_terminal_sessions.`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "list_hosts":
      return listHosts();
    case "connect_host":
      return connectHost(args);
    case "list_terminal_sessions":
      return listSessions();
    case "read_terminal_output":
      return readOutput(args);
    case "run_terminal_command":
      return runCommand(args);
    case "ask_user":
      return "Error: ask_user is handled by the chat UI and should not reach the executor.";
    default:
      return `Error: unknown tool "${name}".`;
  }
}

async function listHosts(): Promise<string> {
  const [hosts, groups] = await Promise.all([
    ipc.hosts.list(),
    ipc.groups.list(),
  ]);
  if (hosts.length === 0) {
    return "No saved hosts yet. The user can add one in the Hosts view.";
  }
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  return JSON.stringify(
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
  );
}

async function connectHost(args: Record<string, unknown>): Promise<string> {
  const hostId = typeof args.hostId === "string" ? args.hostId : "";
  if (!hostId) return "Error: no hostId given.";

  let host;
  try {
    host = await ipc.hosts.get(hostId);
  } catch {
    return `Error: no saved host with id "${hostId}". Call list_hosts to see valid ids.`;
  }

  const state = useTabsStore.getState();
  const existing = terminalTabs(state.tabs).find(
    (t) =>
      t.hostId === hostId &&
      (t.status === "connected" || t.status === "connecting"),
  );
  if (existing?.status === "connected") {
    state.setActive(existing.id);
    return `Already connected to "${host.label}". sessionId: ${existing.id}`;
  }

  const id =
    existing?.id ?? state.openTerminal({ id: host.id, label: host.label });
  if (existing) state.setActive(existing.id);

  const status = await waitForConnection(id, 30_000);
  if (status === "connected") {
    return `Connected to "${host.label}". sessionId: ${id}`;
  }
  if (status === "connecting" || status === "idle") {
    return `Still connecting to "${host.label}" (sessionId: ${id}). The user may need to answer a prompt in the terminal tab (host key trust, password). Check again later with list_terminal_sessions or read_terminal_output.`;
  }
  const tab = terminalTabs(useTabsStore.getState().tabs).find(
    (t) => t.id === id,
  );
  const detail = tab?.error ? `: ${tab.error}` : ".";
  return `Error: connection to "${host.label}" ${
    status === "error" ? "failed" : "was closed"
  }${detail}`;
}

async function waitForConnection(
  id: string,
  timeoutMs: number,
): Promise<TerminalStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = terminalTabs(useTabsStore.getState().tabs).find(
      (t) => t.id === id,
    );
    if (!tab) return "closed";
    if (tab.status !== "connecting" && tab.status !== "idle") {
      return tab.status;
    }
    await sleep(250);
  }
  return "connecting";
}

function listSessions(): string {
  const state = useTabsStore.getState();
  const sessions = terminalTabs(state.tabs);
  if (sessions.length === 0) {
    return "No terminal sessions are open right now. Use connect_host to open one.";
  }
  const focusedId = targetTerminalId(state);
  return JSON.stringify(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      hostId: s.hostId || undefined,
      status: s.status,
      active: s.id === focusedId,
    })),
  );
}

function readOutput(args: Record<string, unknown>): string {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const tab = resolveTerminalTab(requested);
  if (!tab) return noTerminalSessionError(requested);

  const lines =
    typeof args.lines === "number" && Number.isFinite(args.lines)
      ? Math.min(Math.max(Math.round(args.lines), 1), 500)
      : 60;
  const text = readTerminalContext(tab.id, lines);
  return text || "(the terminal has no output yet)";
}

async function runCommand(args: Record<string, unknown>): Promise<string> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return "Error: no command given.";

  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const tab = resolveTerminalTab(requested);
  if (!tab) return noTerminalSessionError(requested);
  if (tab.status !== "connected") return sessionNotConnectedError(tab);

  const timeoutMs = Math.min(
    typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? args.timeoutMs
      : 10_000,
    30_000,
  );

  const before = readTerminalContext(tab.id, 500) ?? "";
  await ipc.ssh.send(tab.id, `${command}\n`);
  const after = await waitForSettledOutput(tab.id, timeoutMs);

  const diff = newOutput(before, after).trim();
  if (diff) return diff;
  return after
    ? "(the command produced no new output)"
    : "(the command produced no output)";
}

function newOutput(before: string, after: string): string {
  if (!before) return after;
  if (after.startsWith(before)) return after.slice(before.length);

  const b = before.split("\n");
  const a = after.split("\n");
  for (let k = Math.min(b.length, a.length); k > 0; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (b[b.length - k + i] !== a[i]) {
        match = false;
        break;
      }
    }
    if (match) return a.slice(k).join("\n");
  }
  return after;
}

async function waitForSettledOutput(
  id: string,
  timeoutMs: number,
): Promise<string> {
  const settleGap = 700;
  const pollInterval = 200;
  const start = Date.now();

  await sleep(pollInterval);
  let last = readTerminalContext(id, 500) ?? "";
  let lastChangeAt = Date.now();

  while (Date.now() - start < timeoutMs) {
    const current = readTerminalContext(id, 500) ?? "";
    if (current !== last) {
      last = current;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= settleGap) {
      break;
    }
    await sleep(pollInterval);
  }
  return last;
}
