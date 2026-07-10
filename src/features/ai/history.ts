import type { AiChatMessage } from "@/types/models";

// Leaves room for the system prompt, tool schemas, current context, and a
// 4K-token response on models with moderately sized context windows.
export const MODEL_HISTORY_TOKEN_BUDGET = 12_000;

const OMITTED_MARKER = "\n… [older content omitted to fit context] …\n";

export interface ModelHistoryWindow {
  messages: AiChatMessage[];
  estimatedTokens: number;
  omittedMessages: number;
  compactedMessages: number;
}

/**
 * Conservative cross-provider estimate. Exact tokenizers differ by model, so
 * code-heavy ASCII is budgeted at three characters per token and non-ASCII at
 * two tokens per code point.
 */
export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 3) + nonAscii * 2;
}

export function estimateMessageTokens(message: AiChatMessage): number {
  let tokens = 12 + estimateTextTokens(message.content ?? "");
  for (const call of message.toolCalls ?? []) {
    tokens +=
      12 +
      estimateTextTokens(call.id) +
      estimateTextTokens(call.name) +
      estimateTextTokens(JSON.stringify(call.arguments));
  }
  if (message.toolCallId) tokens += estimateTextTokens(message.toolCallId);
  return tokens;
}

function estimateMessages(messages: AiChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
}

function cloneMessage(message: AiChatMessage): AiChatMessage {
  return {
    ...message,
    toolCalls: message.toolCalls?.map((call) => ({ ...call })),
  };
}

function splitUserTurns(messages: AiChatMessage[]): AiChatMessage[][] {
  const turns: AiChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" && turns.at(-1)?.length) {
      turns.push([]);
    } else if (turns.length === 0) {
      turns.push([]);
    }
    turns.at(-1)!.push(message);
  }
  return turns;
}

function clipText(text: string, maxTokens: number): string {
  if (estimateTextTokens(text) <= maxTokens) return text;
  const markerTokens = estimateTextTokens(OMITTED_MARKER);
  if (maxTokens <= markerTokens) return OMITTED_MARKER.trim();

  const characters = [...text];
  let keepChars = Math.max(
    1,
    Math.floor(
      (characters.length * (maxTokens - markerTokens)) /
        Math.max(estimateTextTokens(text), 1),
    ),
  );
  let clipped: string;
  do {
    const headChars = Math.floor(keepChars / 4);
    const tailChars = keepChars - headChars;
    clipped = `${characters.slice(0, headChars).join("")}${OMITTED_MARKER}${characters.slice(-tailChars).join("")}`;
    keepChars = Math.floor(keepChars * 0.85);
  } while (estimateTextTokens(clipped) > maxTokens && keepChars > 0);
  return clipped;
}

function compactTurn(
  turn: AiChatMessage[],
  budget: number,
): { messages: AiChatMessage[]; compactedMessages: number } {
  const messages = turn.map(cloneMessage);
  let total = estimateMessages(messages);
  let compactedMessages = 0;
  if (total <= budget) return { messages, compactedMessages };

  // Tool output is reproducible and usually the largest content. Compact it
  // before assistant reasoning and the user's request, oldest first.
  const candidates = ["tool", "assistant", "user"].flatMap((role) =>
    messages.filter(
      (message) => message.role === role && Boolean(message.content),
    ),
  );

  for (const message of candidates) {
    if (total <= budget || !message.content) break;
    const contentTokens = estimateTextTokens(message.content);
    const targetTokens = Math.max(32, contentTokens - (total - budget));
    const clipped = clipText(message.content, targetTokens);
    if (clipped === message.content) continue;
    message.content = clipped;
    compactedMessages += 1;
    total = estimateMessages(messages);
  }

  return { messages, compactedMessages };
}

/**
 * Creates the request-only history window. Full history remains untouched for
 * persistence and UI. Previous turns are included only as complete units, so
 * tool calls never lose their corresponding tool results.
 */
export function modelHistoryWindow(
  history: AiChatMessage[],
  budget = MODEL_HISTORY_TOKEN_BUDGET,
): ModelHistoryWindow {
  if (history.length === 0) {
    return {
      messages: [],
      estimatedTokens: 0,
      omittedMessages: 0,
      compactedMessages: 0,
    };
  }

  const turns = splitUserTurns(history);
  const currentTurn = turns.at(-1)!;
  const current = compactTurn(currentTurn, budget);
  const selected = [current.messages];
  let estimatedTokens = estimateMessages(current.messages);
  let selectedOriginalMessages = currentTurn.length;

  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnTokens = estimateMessages(turn);
    if (estimatedTokens + turnTokens > budget) break;
    selected.unshift(turn.map(cloneMessage));
    selectedOriginalMessages += turn.length;
    estimatedTokens += turnTokens;
  }

  return {
    messages: selected.flat(),
    estimatedTokens,
    omittedMessages: history.length - selectedOriginalMessages,
    compactedMessages: current.compactedMessages,
  };
}
