import { ipc } from "@/lib/ipc";
import type { AiToolSpec } from "@/types/models";
import { readTerminalContext } from "@/features/terminal/registry";
import { useSessionStore } from "@/features/terminal/sessionStore";

/**
 * Tools the agent can call. Read-only tools run automatically the moment the
 * model asks for them; `run_terminal_command` executes on a live remote
 * server, so callers must gate it behind an explicit user approval (see
 * `TOOLS_REQUIRING_APPROVAL`) before invoking `executeTool`.
 */
export const AI_TOOL_SPECS: AiToolSpec[] = [
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

/** Tools that act on a live remote server and must be user-approved first. */
export const TOOLS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set([
  "run_terminal_command",
]);

/** Narrow a tool call's raw JSON arguments to a plain object. */
export function normalizeArgs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** Resolve which session a tool call should target. */
function resolveSessionId(requested?: string): string | null {
  const { sessions, activeId } = useSessionStore.getState();
  if (requested) {
    return sessions.some((s) => s.id === requested) ? requested : null;
  }
  return activeId;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Run one tool call locally and return the text to feed back to the model. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "list_terminal_sessions":
      return listSessions();
    case "read_terminal_output":
      return readOutput(args);
    case "run_terminal_command":
      return runCommand(args);
    default:
      return `Error: unknown tool "${name}".`;
  }
}

function listSessions(): string {
  const { sessions, activeId } = useSessionStore.getState();
  if (sessions.length === 0) {
    return "No terminal sessions are open right now.";
  }
  return JSON.stringify(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      active: s.id === activeId,
    })),
  );
}

function noSessionError(requested?: string): string {
  return requested
    ? `Error: no terminal session with id "${requested}". Call list_terminal_sessions to see valid ids.`
    : "Error: no active terminal session. Call list_terminal_sessions first, then pass a sessionId.";
}

function readOutput(args: Record<string, unknown>): string {
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const id = resolveSessionId(requested);
  if (!id) return noSessionError(requested);

  const lines =
    typeof args.lines === "number" && Number.isFinite(args.lines)
      ? Math.min(Math.max(Math.round(args.lines), 1), 500)
      : 60;
  const text = readTerminalContext(id, lines);
  return text || "(the terminal has no output yet)";
}

async function runCommand(args: Record<string, unknown>): Promise<string> {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) return "Error: no command given.";

  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const id = resolveSessionId(requested);
  if (!id) return noSessionError(requested);

  const timeoutMs = Math.min(
    typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? args.timeoutMs
      : 10_000,
    30_000,
  );

  const before = readTerminalContext(id, 500) ?? "";
  await ipc.ssh.send(id, `${command}\n`);
  const after = await waitForSettledOutput(id, timeoutMs);

  if (before && after.startsWith(before)) {
    const diff = after.slice(before.length).trim();
    return diff || "(the command produced no new output)";
  }
  return after || "(the command produced no output)";
}

/** Poll the terminal buffer until it stops changing (or the timeout hits). */
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
