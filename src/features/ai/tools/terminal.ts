import { Eye, History, ListTree, Terminal as TerminalIcon } from "lucide-react";

import { isShellPromptLine } from "@/features/terminal/autocomplete/engine";
import { getSession, readTerminalContext } from "@/features/terminal/sessions";
import { ipc } from "@/lib/ipc";
import { layoutPaneIds } from "@/workbench/pane-layout";
import {
  paneTab,
  targetPaneId,
  terminalPanes,
  terminalTabs,
  useTabsStore,
  type EditorTab,
  type TerminalPane,
} from "@/workbench/tabs";
import {
  num,
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type PreparedCall,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

const MAX_TERMINAL_READ_LINES = 2_000;

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function resolveTerminalPane(requested?: string): TerminalPane | null {
  const state = useTabsStore.getState();
  const sessions = terminalPanes(state.tabs);
  if (requested) {
    return sessions.find((s) => s.id === requested) ?? null;
  }
  const id = targetPaneId(state);
  return sessions.find((s) => s.id === id) ?? null;
}

export interface TerminalTargetDisplay {
  title: string;
  paneIndex?: number;
  paneCount?: number;
}

export function terminalTargetDisplay(
  tabs: readonly EditorTab[],
  sessionId: string,
): TerminalTargetDisplay | undefined {
  const tab = paneTab(tabs, sessionId);
  const pane = tab?.panes.find((item) => item.id === sessionId);
  if (!tab || !pane) return undefined;

  const ordered = layoutPaneIds(tab.layout);
  const index = ordered.indexOf(sessionId);
  return {
    title: pane.title,
    paneIndex: ordered.length > 1 && index >= 0 ? index + 1 : undefined,
    paneCount: ordered.length > 1 ? ordered.length : undefined,
  };
}

export function noTerminalSessionError(requested?: string): string {
  return requested
    ? `Error: no terminal session with id "${requested}". Call list_terminal_sessions to see valid ids.`
    : "Error: no active terminal session. Call list_terminal_sessions to pick one, or connect_host to open one.";
}

export function sessionNotConnectedError(pane: TerminalPane): string {
  return `Error: terminal session "${pane.title}" (${pane.id}) is not connected (status: ${pane.status}). Reconnect it with connect_host or pick a connected session from list_terminal_sessions.`;
}

export function prepareTerminalTarget(
  args: Record<string, unknown>,
): PreparedCall {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const pane = resolveTerminalPane(requested);
  if (!pane) {
    return { args, preflightError: noTerminalSessionError(requested) };
  }
  if (pane.status !== "connected") {
    return {
      args: { ...args, sessionId: pane.id },
      preflightError: sessionNotConnectedError(pane),
    };
  }
  return { args: { ...args, sessionId: pane.id } };
}

export function terminalReadLineLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), 1), MAX_TERMINAL_READ_LINES)
    : 60;
}

export function newOutput(before: string, after: string): string {
  if (!before) return after;
  if (after.startsWith(before)) {
    const suffix = after.slice(before.length);
    return suffix.startsWith("\n") ? suffix.slice(1) : suffix;
  }

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
  isCancelled: () => boolean = () => false,
  waitForPrompt = false,
  initialOutput = "",
): Promise<string> {
  const settleGap = 700;
  const pollInterval = 200;
  const start = Date.now();

  await sleep(pollInterval);
  let last = readTerminalContext(id, MAX_TERMINAL_READ_LINES) ?? "";
  let lastChangeAt = Date.now();

  while (Date.now() - start < timeoutMs) {
    const current = readTerminalContext(id, MAX_TERMINAL_READ_LINES) ?? "";
    if (isCancelled()) return current;
    if (current !== last) {
      last = current;
      lastChangeAt = Date.now();
    }
    const lastLine = current.split("\n").at(-1) ?? "";
    if (
      waitForPrompt &&
      current !== initialOutput &&
      isShellPromptLine(lastLine)
    ) {
      break;
    }
    if (!waitForPrompt && Date.now() - lastChangeAt >= settleGap) {
      break;
    }
    await sleep(pollInterval);
  }
  return last;
}

function listSessions(): ToolExecutionResult {
  const state = useTabsStore.getState();
  const tabs = terminalTabs(state.tabs);
  if (tabs.length === 0) {
    return toolSuccess(
      "No terminal sessions are open right now. Use connect_host to open one.",
    );
  }
  const focusedId = targetPaneId(state);
  return toolSuccess(
    JSON.stringify(
      tabs.flatMap((tab) => {
        const ordered = layoutPaneIds(tab.layout);
        return ordered.flatMap((paneId, index) => {
          const pane = tab.panes.find((item) => item.id === paneId);
          if (!pane) return [];
          return [
            {
              id: pane.id,
              title: pane.title,
              hostId: pane.hostId || undefined,
              status: pane.status,
              current: pane.id === focusedId,
              pane:
                ordered.length > 1
                  ? `${index + 1}/${ordered.length}`
                  : undefined,
            },
          ];
        });
      }),
    ),
  );
}

function readOutput(args: Record<string, unknown>): ToolExecutionResult {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const pane = resolveTerminalPane(requested);
  if (!pane) return toolFailure(noTerminalSessionError(requested));

  const lines = terminalReadLineLimit(args.lines);
  const text = readTerminalContext(pane.id, lines);
  return toolSuccess(text || "(the terminal has no output yet)");
}

export async function executeTerminalCommand(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return toolFailure("Error: no command given.");

  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const pane = resolveTerminalPane(requested);
  if (!pane) return toolFailure(noTerminalSessionError(requested));
  if (pane.status !== "connected") {
    return toolFailure(sessionNotConnectedError(pane));
  }

  const timeoutMs = Math.min(
    typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? args.timeoutMs
      : 10_000,
    30_000,
  );

  const session = getSession(pane.id);
  if (!session) return toolFailure(noTerminalSessionError(requested));
  const before = readTerminalContext(pane.id, MAX_TERMINAL_READ_LINES) ?? "";
  const promptBefore = before.split("\n").at(-1) ?? "";
  session.sendCommand(command);
  const after = await waitForSettledOutput(
    pane.id,
    timeoutMs,
    context.isCancelled,
    isShellPromptLine(promptBefore),
    before,
  );
  if (context.isCancelled?.()) {
    return toolFailure(
      "Error: the assistant run was stopped; the command had already started and may still be running in the terminal.",
    );
  }

  const diff = newOutput(before, after).trim();
  if (diff) return toolSuccess(diff);
  return toolSuccess(
    after
      ? "(the command produced no new output)"
      : "(the command produced no output)",
  );
}

async function searchHistory(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const prefix = str(args, "prefix");
  const hostId = optionalStr(args, "hostId") ?? null;
  const limit = num(args, "limit");
  const results = await ipc.history.search(hostId, prefix, limit);
  if (results.length === 0) {
    return toolSuccess("No matching commands in history.");
  }
  return toolSuccess(results.join("\n"));
}

async function listCommandHistory(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const hostId = "hostId" in args ? (optionalStr(args, "hostId") ?? "") : null;
  const query = str(args, "query");
  const limit = num(args, "limit");
  const entries = await ipc.history.list(hostId, query, limit);
  return toolSuccess(JSON.stringify(entries));
}

async function clearCommandHistory(): Promise<ToolExecutionResult> {
  await ipc.history.clear();
  return toolSuccess("Cleared command history.");
}

async function openLocalTerminal(): Promise<ToolExecutionResult> {
  const id = useTabsStore.getState().openLocalTerminal();
  return id
    ? toolSuccess(`Opened local terminal. sessionId: ${id}`)
    : toolFailure("Error: the terminal session limit has been reached.");
}

async function openAdhocTerminal(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const host = optionalStr(args, "host");
  const username = optionalStr(args, "username");
  if (!host || !username) {
    return toolFailure("Error: host and username are required.");
  }
  const id = useTabsStore.getState().openAdhocTerminal({
    host,
    username,
    port: num(args, "port") ?? 22,
  });
  return id
    ? toolSuccess(`Opened temporary SSH terminal. sessionId: ${id}`)
    : toolFailure("Error: the terminal session limit has been reached.");
}

async function splitTerminal(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pane = resolveTerminalPane(optionalStr(args, "sessionId"));
  if (!pane) return toolFailure(noTerminalSessionError(str(args, "sessionId")));
  const direction =
    optionalStr(args, "direction") === "down" ? "down" : "right";
  const id = useTabsStore.getState().splitPane(pane.id, direction);
  return id
    ? toolSuccess(`Split terminal ${direction}. sessionId: ${id}`)
    : toolFailure("Error: the terminal pane limit has been reached.");
}

async function closeTerminal(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pane = resolveTerminalPane(optionalStr(args, "sessionId"));
  if (!pane) return toolFailure(noTerminalSessionError(str(args, "sessionId")));
  useTabsStore.getState().closePane(pane.id);
  return toolSuccess(`Closed terminal ${pane.id}.`);
}

async function focusTerminal(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pane = resolveTerminalPane(optionalStr(args, "sessionId"));
  if (!pane) return toolFailure(noTerminalSessionError(str(args, "sessionId")));
  useTabsStore.getState().focusPane(pane.id);
  return toolSuccess(`Focused terminal ${pane.id}.`);
}

async function reconnectTerminal(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pane = resolveTerminalPane(optionalStr(args, "sessionId"));
  if (!pane) return toolFailure(noTerminalSessionError(str(args, "sessionId")));
  useTabsStore.getState().reconnectTerminal(pane.id);
  return toolSuccess(`Reconnecting terminal ${pane.id}.`);
}

async function sendTerminalInput(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const pane = resolveTerminalPane(optionalStr(args, "sessionId"));
  if (!pane) return toolFailure(noTerminalSessionError(str(args, "sessionId")));
  if (pane.status !== "connected")
    return toolFailure(sessionNotConnectedError(pane));
  const data = str(args, "data");
  getSession(pane.id)?.send(data);
  useTabsStore.getState().focusPane(pane.id);
  return toolSuccess(
    `Sent ${data.length} character(s) to terminal ${pane.id}.`,
  );
}

async function listConnectionPrompts(): Promise<ToolExecutionResult> {
  const [hostKeys, passwords] = await Promise.all([
    ipc.ssh.pendingHostKeys(),
    ipc.ssh.pendingPasswords(),
  ]);
  return toolSuccess(JSON.stringify({ hostKeys, passwords }));
}

async function respondHostKeyPrompt(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const promptId = str(args, "promptId");
  const decision = optionalStr(args, "decision");
  if (!promptId || !decision) {
    return toolFailure("Error: promptId and decision are required.");
  }
  if (!["reject", "once", "remember"].includes(decision)) {
    return toolFailure("Error: invalid host key decision.");
  }
  await ipc.ssh.respondHostKey(
    promptId,
    decision as "reject" | "once" | "remember",
  );
  return toolSuccess(`Responded to host key prompt ${promptId}.`);
}

async function respondPasswordPrompt(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const promptId = str(args, "promptId");
  if (!promptId) return toolFailure("Error: no promptId given.");
  const password = "password" in args ? str(args, "password") : null;
  await ipc.ssh.respondPassword(promptId, password);
  return toolSuccess(`Responded to password prompt ${promptId}.`);
}

const SESSION_ID_PARAMETER = {
  sessionId: {
    type: "string",
    description:
      "Session id from list_terminal_sessions. Omit to use the current terminal.",
  },
} as const;

export const terminalTools: AiTool[] = [
  {
    spec: {
      name: "list_terminal_sessions",
      description:
        "List open terminal ids, titles, statuses, and the current marker. Split panes are separate sessions; a pane field like 1/2 marks panes sharing one tab. Do not call merely to reconfirm the Current terminal in app context.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: ListTree,
    labelKey: "ai.tool.listTerminalSessions",
    execute: async () => listSessions(),
  },
  {
    spec: {
      name: "read_terminal_output",
      description:
        "Read recent on-screen terminal output. Omit sessionId for the Current terminal. Use it instead of asking the user to paste output. Results beyond ~30K characters are truncated in the middle (head and tail kept).",
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
            description: "Recent lines to return (default 60, max 2000).",
          },
        },
        additionalProperties: false,
      },
    },
    icon: Eye,
    labelKey: "ai.tool.readTerminalOutput",
    requiresApproval: true,
    alwaysRequireApproval: true,
    untrustedResult: true,
    execute: async (args) => readOutput(args),
  },
  {
    spec: {
      name: "run_terminal_command",
      description:
        "Run a command in a live terminal and return settled output. This requires user approval in supervised mode and runs automatically in autonomous mode. Omit sessionId for the Current terminal; never ask to reconfirm it. Results beyond ~30K characters are truncated in the middle (head and tail kept). To read a file or log with thousands of lines completely, first count its lines, then page through it with `sed -n 'START,ENDp' FILE` in consecutive chunks of about 200 lines; continue until the requested range is covered and never treat a truncated result as a complete file.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            minLength: 1,
            maxLength: 32 * 1024,
            description: "The exact shell command to run.",
          },
          sessionId: {
            type: "string",
            description:
              "Session id from list_terminal_sessions. Omit to use the session the user currently has focused.",
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
            maximum: 30_000,
            description: "Output wait in ms (default 10000, max 30000).",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.runTerminalCommand",
    requiresApproval: true,
    untrustedResult: true,
    confirmKey: "ai.confirmRun",
    prepare: (args) => prepareTerminalTarget(args),
    execute: executeTerminalCommand,
  },
  {
    spec: {
      name: "search_command_history",
      description:
        "Search previously run commands. Omit prefix for the most recent commands; pass hostId to scope to one host.",
      parameters: {
        type: "object",
        properties: {
          prefix: {
            type: "string",
            description: "Match commands starting with this text.",
          },
          hostId: {
            type: "string",
            description: "Host id to scope the search. Omit for all hosts.",
          },
          limit: {
            type: "integer",
            description: "Max results (default 20).",
          },
        },
        additionalProperties: false,
      },
    },
    icon: History,
    labelKey: "ai.tool.searchCommandHistory",
    execute: async (args) => searchHistory(args),
  },
  {
    spec: {
      name: "list_command_history",
      description:
        "List detailed command history entries. Omit hostId for all hosts, or set it to an empty string for local terminals.",
      parameters: {
        type: "object",
        properties: {
          hostId: { type: "string" },
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
        },
        additionalProperties: false,
      },
    },
    icon: History,
    labelKey: "ai.tool.listCommandHistory",
    execute: async (args) => listCommandHistory(args),
  },
  {
    spec: {
      name: "clear_command_history",
      description: "Permanently clear all command history.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: History,
    labelKey: "ai.tool.clearCommandHistory",
    requiresApproval: true,
    execute: async () => clearCommandHistory(),
  },
  {
    spec: {
      name: "open_local_terminal",
      description: "Open a new local shell terminal.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.openLocalTerminal",
    requiresApproval: true,
    execute: async () => openLocalTerminal(),
  },
  {
    spec: {
      name: "open_temporary_ssh_terminal",
      description: "Open a temporary SSH terminal without saving a host.",
      parameters: {
        type: "object",
        properties: {
          host: { type: "string", description: "Hostname or IP address." },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          username: { type: "string", description: "Login user." },
        },
        required: ["host", "username"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.openTemporarySshTerminal",
    requiresApproval: true,
    execute: async (args) => openAdhocTerminal(args),
  },
  {
    spec: {
      name: "send_terminal_input",
      description:
        "Send exact interactive input to a connected terminal, including control characters.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_ID_PARAMETER,
          data: { type: "string", description: "Exact input bytes as text." },
        },
        required: ["data"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.sendTerminalInput",
    requiresApproval: true,
    execute: async (args) => sendTerminalInput(args),
  },
  {
    spec: {
      name: "list_connection_prompts",
      description: "List pending SSH host key and password prompts.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.listConnectionPrompts",
    execute: async () => listConnectionPrompts(),
  },
  {
    spec: {
      name: "respond_host_key_prompt",
      description:
        "Accept a host key once, remember it, or reject the connection prompt.",
      parameters: {
        type: "object",
        properties: {
          promptId: { type: "string" },
          decision: {
            type: "string",
            enum: ["reject", "once", "remember"],
          },
        },
        required: ["promptId", "decision"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.respondHostKeyPrompt",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => respondHostKeyPrompt(args),
  },
  {
    spec: {
      name: "respond_password_prompt",
      description:
        "Submit a password to a pending SSH prompt, or omit password to cancel it.",
      parameters: {
        type: "object",
        properties: {
          promptId: { type: "string" },
          password: { type: "string" },
        },
        required: ["promptId"],
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.respondPasswordPrompt",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => respondPasswordPrompt(args),
  },
  {
    spec: {
      name: "split_terminal",
      description: "Split a terminal pane to the right or down.",
      parameters: {
        type: "object",
        properties: {
          ...SESSION_ID_PARAMETER,
          direction: { type: "string", enum: ["right", "down"] },
        },
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.splitTerminal",
    requiresApproval: true,
    execute: async (args) => splitTerminal(args),
  },
  {
    spec: {
      name: "close_terminal",
      description: "Close a terminal pane or its tab when it is the last pane.",
      parameters: {
        type: "object",
        properties: SESSION_ID_PARAMETER,
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.closeTerminal",
    requiresApproval: true,
    execute: async (args) => closeTerminal(args),
  },
  {
    spec: {
      name: "focus_terminal",
      description: "Focus an open terminal pane.",
      parameters: {
        type: "object",
        properties: SESSION_ID_PARAMETER,
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.focusTerminal",
    requiresApproval: true,
    execute: async (args) => focusTerminal(args),
  },
  {
    spec: {
      name: "reconnect_terminal",
      description: "Reconnect a closed or failed terminal session.",
      parameters: {
        type: "object",
        properties: SESSION_ID_PARAMETER,
        additionalProperties: false,
      },
    },
    icon: TerminalIcon,
    labelKey: "ai.tool.reconnectTerminal",
    requiresApproval: true,
    execute: async (args) => reconnectTerminal(args),
  },
];
