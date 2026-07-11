import { Eye, History, ListTree, Terminal as TerminalIcon } from "lucide-react";

import { isShellPromptLine } from "@/features/terminal/autocomplete/engine";
import { getSession, readTerminalContext } from "@/features/terminal/sessions";
import { ipc } from "@/lib/ipc";
import {
  targetTerminalId,
  terminalTabs,
  useTabsStore,
  type TerminalTab,
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

export const MAX_TERMINAL_READ_LINES = 2_000;

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

export function prepareTerminalTarget(
  args: Record<string, unknown>,
): PreparedCall {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const tab = resolveTerminalTab(requested);
  if (!tab) {
    return { args, preflightError: noTerminalSessionError(requested) };
  }
  if (tab.status !== "connected") {
    return {
      args: { ...args, sessionId: tab.id },
      preflightError: sessionNotConnectedError(tab),
    };
  }
  return { args: { ...args, sessionId: tab.id } };
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
  const sessions = terminalTabs(state.tabs);
  if (sessions.length === 0) {
    return toolSuccess(
      "No terminal sessions are open right now. Use connect_host to open one.",
    );
  }
  const focusedId = targetTerminalId(state);
  return toolSuccess(
    JSON.stringify(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        hostId: s.hostId || undefined,
        status: s.status,
        current: s.id === focusedId,
      })),
    ),
  );
}

function readOutput(args: Record<string, unknown>): ToolExecutionResult {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const tab = resolveTerminalTab(requested);
  if (!tab) return toolFailure(noTerminalSessionError(requested));

  const lines = terminalReadLineLimit(args.lines);
  const text = readTerminalContext(tab.id, lines);
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
  const tab = resolveTerminalTab(requested);
  if (!tab) return toolFailure(noTerminalSessionError(requested));
  if (tab.status !== "connected") {
    return toolFailure(sessionNotConnectedError(tab));
  }

  const timeoutMs = Math.min(
    typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? args.timeoutMs
      : 10_000,
    30_000,
  );

  const session = getSession(tab.id);
  if (!session) return toolFailure(noTerminalSessionError(requested));
  const before = readTerminalContext(tab.id, MAX_TERMINAL_READ_LINES) ?? "";
  const promptBefore = before.split("\n").at(-1) ?? "";
  session.sendCommand(command);
  const after = await waitForSettledOutput(
    tab.id,
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

export const terminalTools: AiTool[] = [
  {
    spec: {
      name: "list_terminal_sessions",
      description:
        "List open terminal ids, titles, statuses, and the current marker. Do not call merely to reconfirm the Current terminal in app context.",
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
            description: "The exact shell command to run.",
          },
          sessionId: {
            type: "string",
            description:
              "Session id from list_terminal_sessions. Omit to use the session the user currently has focused.",
          },
          timeoutMs: {
            type: "integer",
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
];
