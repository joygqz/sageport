import { ipc } from "@/lib/ipc";
import type { AiToolSpec } from "@/types/models";
import { getSession, readTerminalContext } from "@/features/terminal/sessions";
import { isShellPromptLine } from "@/features/terminal/autocomplete/engine";
import {
  targetTerminalId,
  terminalTabs,
  useTabsStore,
  type TerminalStatus,
  type TerminalTab,
} from "@/workbench/tabs";

const MAX_TERMINAL_READ_LINES = 2_000;

export const AI_TOOL_SPECS: AiToolSpec[] = [
  {
    name: "list_hosts",
    description:
      "List saved hosts with ids and connection details. Use when an explicitly requested host is not identified by current context.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "connect_host",
    description:
      "Connect a saved host by id and return its terminal session id. Reuses or reconnects an existing tab.",
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
      "Show 2-6 choice buttons when a real choice remains. Never use it to confirm the current-terminal default or a command; write short options in the user's language.",
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
      "List open terminal ids, titles, statuses, and the current marker. Do not call merely to reconfirm the Current terminal in app context.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
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
  {
    name: "run_terminal_command",
    description:
      "Run a command in a live terminal after user approval and return settled output. Omit sessionId for the Current terminal; never ask to reconfirm it. Results beyond ~30K characters are truncated in the middle (head and tail kept). To read a file or log with thousands of lines completely, first count its lines, then page through it with `sed -n 'START,ENDp' FILE` in consecutive chunks of about 200 lines; continue until the requested range is covered and never treat a truncated result as a complete file.",
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
];

export type AiToolName = (typeof AI_TOOL_SPECS)[number]["name"];

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

export interface ToolExecutionContext {
  isCancelled?: () => boolean;
}

function toolSuccess(content: string): ToolExecutionResult {
  return { content, isError: false };
}

function toolFailure(content: string): ToolExecutionResult {
  return { content, isError: true };
}

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

const TARGET_QUESTION_RE =
  /\b(?:host|server|terminal|session|machine)\b|主机|服务器|终端|会话|哪台|哪个环境/i;
const CURRENT_OPTION_RE = /\bcurrent\b|当前|正在查看|正在使用/i;
const MULTI_TARGET_RE =
  /\b(?:both|all|every|each)\b|两台|全部|所有|每台|分别|都(?:查看|检查|执行|运行)/i;

function comparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Models occasionally ask the user to choose a host even though the app has
 * already supplied a current terminal. Resolve only that redundant choice;
 * genuine multi-host or explicitly named-host requests still reach the user.
 */
export function defaultTerminalOption(
  args: Record<string, unknown>,
  userPrompt: string,
): { option: string; tab: TerminalTab } | null {
  const question = askUserQuestion(args);
  const options = askUserOptions(args);
  if (!question || options.length < 2 || !TARGET_QUESTION_RE.test(question)) {
    return null;
  }

  const state = useTabsStore.getState();
  const current = resolveTerminalTab();
  if (!current || current.status !== "connected") return null;

  const prompt = comparableText(userPrompt);
  if (MULTI_TARGET_RE.test(prompt)) return null;

  const otherTargets = terminalTabs(state.tabs).filter(
    (tab) => tab.id !== current.id,
  );
  if (
    otherTargets.some((tab) => {
      const title = comparableText(tab.title);
      return title.length >= 3 && prompt.includes(title);
    })
  ) {
    return null;
  }

  const currentTitle = comparableText(current.title);
  const explicitlyNamedOption = options.some((candidate) => {
    const normalized = comparableText(candidate);
    const describesCurrent =
      CURRENT_OPTION_RE.test(candidate) ||
      normalized === currentTitle ||
      (currentTitle.length >= 3 && normalized.includes(currentTitle));
    return (
      !describesCurrent &&
      !MULTI_TARGET_RE.test(candidate) &&
      normalized.length >= 3 &&
      prompt.includes(normalized)
    );
  });
  if (explicitlyNamedOption) return null;

  const option = options.find((candidate) => {
    const normalized = comparableText(candidate);
    return (
      CURRENT_OPTION_RE.test(candidate) ||
      normalized === currentTitle ||
      (currentTitle.length >= 3 && normalized.includes(currentTitle)) ||
      normalized.includes(comparableText(current.id))
    );
  });
  return option ? { option, tab: current } : null;
}

export function automaticTerminalSelectionResult(
  option: string,
  tab: TerminalTab,
): string {
  return `The app automatically selected the current terminal: ${option} (title: "${tab.title}", sessionId: ${tab.id}). Continue without asking the user to choose a server.`;
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
  context: ToolExecutionContext = {},
): Promise<ToolExecutionResult> {
  switch (name) {
    case "list_hosts":
      return listHosts();
    case "connect_host":
      return connectHost(args, context);
    case "list_terminal_sessions":
      return listSessions();
    case "read_terminal_output":
      return readOutput(args);
    case "run_terminal_command":
      return runCommand(args, context);
    case "ask_user":
      return toolFailure(
        "Error: ask_user is handled by the chat UI and should not reach the executor.",
      );
    default:
      return toolFailure(`Error: unknown tool "${name}".`);
  }
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

async function connectHost(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const hostId = typeof args.hostId === "string" ? args.hostId : "";
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
  if (existing) {
    state.setActive(existing.id);
    if (existing.status === "closed" || existing.status === "error") {
      state.reconnectTerminal(existing.id);
    }
  }

  const status = await waitForConnection(id, 30_000, context.isCancelled);
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

async function runCommand(
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

  const diff = newOutput(before, after).trim();
  if (diff) return toolSuccess(diff);
  return toolSuccess(
    after
      ? "(the command produced no new output)"
      : "(the command produced no output)",
  );
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
