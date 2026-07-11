import type { AiChatMessage, AiModelLimits } from "@/types/models";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;
export const MAX_OUTPUT_TOKENS = 64_000;
export const PROMPT_RESERVE_TOKENS = 8_000;
export const MAX_HISTORY_TOKEN_BUDGET = 200_000;

function contextWindowTokens(limits?: Partial<AiModelLimits> | null): number {
  const window = limits?.contextWindow;
  return window && window > 0 ? window : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export function outputTokenBudget(
  limits?: Partial<AiModelLimits> | null,
): number {
  const reported = limits?.maxOutputTokens;
  const requested =
    reported && reported > 0 ? reported : DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(
    1,
    Math.min(
      requested,
      MAX_OUTPUT_TOKENS,
      Math.floor(contextWindowTokens(limits) / 4),
    ),
  );
}

export function historyTokenBudget(
  limits?: Partial<AiModelLimits> | null,
): number {
  const contextWindow = contextWindowTokens(limits);
  const promptReserve = Math.min(
    PROMPT_RESERVE_TOKENS,
    Math.floor(contextWindow / 4),
  );
  const budget = contextWindow - outputTokenBudget(limits) - promptReserve;
  return Math.max(0, Math.min(budget, MAX_HISTORY_TOKEN_BUDGET));
}

const OMITTED_MARKER = "\n… [older content omitted to fit context] …\n";

export interface ModelHistoryWindow {
  messages: AiChatMessage[];
  estimatedTokens: number;
  omittedMessages: number;
  compactedMessages: number;
}

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
    toolCalls: message.toolCalls?.map((call) => ({
      ...call,
      arguments: structuredClone(call.arguments),
    })),
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

  for (const message of messages) {
    if (total <= budget) break;
    for (const call of message.toolCalls ?? []) {
      if (total <= budget) break;
      const argumentTokens = estimateTextTokens(JSON.stringify(call.arguments));
      if (argumentTokens <= 24) continue;
      call.arguments = {
        _omitted:
          "Completed tool arguments omitted to fit the model context window.",
      };
      compactedMessages += 1;
      total = estimateMessages(messages);
    }
  }

  return { messages, compactedMessages };
}

export function modelHistoryWindow(
  history: AiChatMessage[],
  budget = historyTokenBudget(),
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
  let compactedMessages = current.compactedMessages;

  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const turn = turns[index];
    const remaining = budget - estimatedTokens;
    const turnTokens = estimateMessages(turn);
    if (turnTokens <= remaining) {
      selected.unshift(turn.map(cloneMessage));
      selectedOriginalMessages += turn.length;
      estimatedTokens += turnTokens;
      continue;
    }
    const compacted = compactTurn(turn, remaining);
    const compactedTokens = estimateMessages(compacted.messages);
    if (compactedTokens > remaining) break;
    selected.unshift(compacted.messages);
    selectedOriginalMessages += turn.length;
    estimatedTokens += compactedTokens;
    compactedMessages += compacted.compactedMessages;
  }

  return {
    messages: selected.flat(),
    estimatedTokens,
    omittedMessages: history.length - selectedOriginalMessages,
    compactedMessages,
  };
}
