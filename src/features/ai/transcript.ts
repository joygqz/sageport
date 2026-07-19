import type { AiChatMessage } from "@/types/models";
import {
  normalizeArgs,
  redactToolArguments,
  TOOLS_WITH_SENSITIVE_RESULTS,
} from "./tools";

export const DECLINED_RESULT = "The user declined to run this command.";
export const STOPPED_RESULT =
  "The user stopped this run before the call executed.";
export const INTERRUPTED_RESULT =
  "The run was interrupted before this call finished.";

const TOOL_RESULT_HEAD_CHARS = 8_000;
const TOOL_RESULT_TAIL_CHARS = 24_000;
const TOOL_RESULT_MAX_CHARS =
  TOOL_RESULT_HEAD_CHARS + TOOL_RESULT_TAIL_CHARS + 500;

const TITLE_MAX_LEN = 60;
export const MAX_AI_PROMPT_CHARS = 256_000;

export type ToolStatus =
  | "awaiting-approval"
  | "awaiting-input"
  | "running"
  | "done"
  | "denied"
  | "error";

export function completedToolStatus(
  result: string,
  explicitError?: boolean,
): ToolStatus {
  if (explicitError !== undefined) return explicitError ? "error" : "done";
  return result.startsWith("Error:") ? "error" : "done";
}

export type AgentActivity = "thinking" | "responding" | null;

export type AgentLogItem =
  | { id: string; kind: "user"; content: string }
  | { id: string; kind: "assistant"; content: string }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      result?: string;
    };

export interface RuntimeSession {
  history: AiChatMessage[];

  log: AgentLogItem[];
  pending: boolean;
  activity: AgentActivity;

  requestId: string | null;

  stopRequested: boolean;
  stepLimitReached: boolean;

  contextTokens: number | null;
  contextWindow: number | null;

  summary: string;
  summaryUpTo: number;
}

export function truncateToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text;
  const omitted = text.length - TOOL_RESULT_HEAD_CHARS - TOOL_RESULT_TAIL_CHARS;
  return `${text.slice(0, TOOL_RESULT_HEAD_CHARS)}\n… (${omitted} characters omitted from the middle; if you need them, re-read in smaller chunks, e.g. sed -n 'START,ENDp' FILE) …\n${text.slice(-TOOL_RESULT_TAIL_CHARS)}`;
}

export function deriveTitle(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0].trim();
  return firstLine.length > TITLE_MAX_LEN
    ? `${firstLine.slice(0, TITLE_MAX_LEN).trimEnd()}…`
    : firstLine;
}

export function redactSensitiveHistory(
  messages: AiChatMessage[],
): AiChatMessage[] {
  const sensitiveCallIds = new Set(
    messages.flatMap((message) =>
      (message.toolCalls ?? [])
        .filter((call) => TOOLS_WITH_SENSITIVE_RESULTS.has(call.name))
        .map((call) => call.id),
    ),
  );
  return messages.map((message) => ({
    ...message,
    content:
      message.role === "tool" &&
      message.toolCallId &&
      sensitiveCallIds.has(message.toolCallId)
        ? "[REDACTED]"
        : message.content,
    toolCalls: message.toolCalls?.map((call) => ({
      ...call,
      arguments: redactToolArguments(call.name, call.arguments),
    })),
  }));
}

export function repairHistory(messages: AiChatMessage[]): AiChatMessage[] {
  const resolved = new Set(
    messages
      .filter((m) => m.role === "tool" && m.toolCallId)
      .map((m) => m.toolCallId),
  );
  const repaired: AiChatMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    repaired.push(message);
    const missing = (message.toolCalls ?? []).filter(
      (call) => !resolved.has(call.id),
    );
    if (missing.length === 0) continue;

    while (messages[index + 1]?.role === "tool") {
      repaired.push(messages[index + 1]);
      index += 1;
    }
    for (const call of missing) {
      repaired.push({
        role: "tool",
        toolCallId: call.id,
        content: INTERRUPTED_RESULT,
        toolError: false,
      });
    }
  }
  return repaired;
}

export function buildLogFromHistory(messages: AiChatMessage[]): AgentLogItem[] {
  const log: AgentLogItem[] = [];
  const toolItemByCallId = new Map<
    string,
    Extract<AgentLogItem, { kind: "tool" }>
  >();

  for (const m of messages) {
    if (m.role === "user") {
      log.push({
        id: crypto.randomUUID(),
        kind: "user",
        content: m.content ?? "",
      });
    } else if (m.role === "assistant") {
      if (m.content) {
        log.push({
          id: crypto.randomUUID(),
          kind: "assistant",
          content: m.content,
        });
      }
      for (const call of m.toolCalls ?? []) {
        const item: Extract<AgentLogItem, { kind: "tool" }> = {
          id: crypto.randomUUID(),
          kind: "tool",
          toolCallId: call.id,
          name: call.name,
          args: normalizeArgs(call.arguments),
          status: "done",
        };
        log.push(item);
        toolItemByCallId.set(call.id, item);
      }
    } else if (m.role === "tool" && m.toolCallId) {
      const item = toolItemByCallId.get(m.toolCallId);
      if (item) {
        item.result = m.content;
        if (
          m.content === DECLINED_RESULT ||
          m.content === STOPPED_RESULT ||
          m.content === INTERRUPTED_RESULT
        ) {
          item.status = "denied";
        } else if (m.content) {
          item.status = completedToolStatus(m.content, m.toolError);
        }
      }
    }
  }
  return log;
}
