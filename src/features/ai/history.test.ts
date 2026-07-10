import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "@/types/models";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  estimateMessageTokens,
  estimateTextTokens,
  historyTokenBudget,
  MAX_HISTORY_TOKEN_BUDGET,
  MAX_OUTPUT_TOKENS,
  modelHistoryWindow,
  outputTokenBudget,
  PROMPT_RESERVE_TOKENS,
} from "./history";

const user = (content: string): AiChatMessage => ({ role: "user", content });
const assistant = (content: string): AiChatMessage => ({
  role: "assistant",
  content,
});

describe("token estimation", () => {
  it("is conservative for non-ASCII text", () => {
    expect(estimateTextTokens("abc")).toBe(1);
    expect(estimateTextTokens("内存占用")).toBe(8);
  });
});

describe("outputTokenBudget", () => {
  it("respects the reported output cap", () => {
    expect(
      outputTokenBudget({ contextWindow: 200_000, maxOutputTokens: 8_192 }),
    ).toBe(8_192);
  });

  it("clamps large caps and small windows", () => {
    expect(
      outputTokenBudget({
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
      }),
    ).toBe(MAX_OUTPUT_TOKENS);
    expect(outputTokenBudget({ contextWindow: 32_000 })).toBe(8_000);
  });

  it("defaults when the cap is unknown", () => {
    expect(outputTokenBudget(null)).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("never exceeds a provider's small reported cap", () => {
    expect(
      outputTokenBudget({ contextWindow: 4_096, maxOutputTokens: 512 }),
    ).toBe(512);
  });
});

describe("historyTokenBudget", () => {
  it("scales with the model context window", () => {
    expect(historyTokenBudget({ contextWindow: 128_000 })).toBe(
      128_000 - DEFAULT_MAX_OUTPUT_TOKENS - PROMPT_RESERVE_TOKENS,
    );
    expect(historyTokenBudget({ contextWindow: 1_000_000 })).toBe(
      MAX_HISTORY_TOKEN_BUDGET,
    );
  });

  it("never overflows small windows together with output and reserve", () => {
    const limits = { contextWindow: 32_000 };
    expect(
      historyTokenBudget(limits) +
        outputTokenBudget(limits) +
        PROMPT_RESERVE_TOKENS,
    ).toBeLessThanOrEqual(32_000);
  });

  it("scales the reserve down for very small context windows", () => {
    for (const contextWindow of [512, 1_024, 4_096]) {
      const limits = { contextWindow };
      expect(
        historyTokenBudget(limits) + outputTokenBudget(limits),
      ).toBeLessThan(contextWindow);
    }
  });

  it("falls back to the default window when unknown", () => {
    expect(historyTokenBudget(null)).toBe(
      128_000 - DEFAULT_MAX_OUTPUT_TOKENS - PROMPT_RESERVE_TOKENS,
    );
    expect(historyTokenBudget({ contextWindow: 0 })).toBe(
      historyTokenBudget(null),
    );
    expect(historyTokenBudget()).toBe(historyTokenBudget(null));
  });
});

describe("modelHistoryWindow", () => {
  it("keeps short history intact without sharing mutable messages", () => {
    const history = [user("hello"), assistant("hi")];
    const window = modelHistoryWindow(history, 1_000);

    expect(window.messages).toEqual(history);
    expect(window.messages[0]).not.toBe(history[0]);
    expect(window.omittedMessages).toBe(0);
    expect(window.compactedMessages).toBe(0);
  });

  it("drops only complete older user turns", () => {
    const oldTurn = [
      user("old question"),
      {
        role: "assistant" as const,
        toolCalls: [
          { id: "call-old", name: "read_terminal_output", arguments: {} },
        ],
      },
      { role: "tool" as const, toolCallId: "call-old", content: "old output" },
      assistant("old answer"),
    ];
    const currentTurn = [user("new question"), assistant("new answer")];
    const currentTokens = currentTurn.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    );
    const window = modelHistoryWindow(
      [...oldTurn, ...currentTurn],
      currentTokens + 1,
    );

    expect(window.messages).toEqual(currentTurn);
    expect(window.omittedMessages).toBe(oldTurn.length);
    expect(window.messages.some((message) => message.role === "tool")).toBe(
      false,
    );
  });

  it("compacts an oversized previous turn instead of dropping it", () => {
    const oldTurn: AiChatMessage[] = [
      user("run diagnostics"),
      {
        role: "assistant",
        toolCalls: [
          { id: "call-1", name: "read_terminal_output", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: "y".repeat(30_000) },
      assistant("done, memory usage is fine"),
    ];
    const currentTurn = [user("continue")];
    const window = modelHistoryWindow([...oldTurn, ...currentTurn], 2_000);

    expect(window.estimatedTokens).toBeLessThanOrEqual(2_000);
    expect(window.omittedMessages).toBe(0);
    expect(window.compactedMessages).toBeGreaterThan(0);
    expect(window.messages).toHaveLength(oldTurn.length + currentTurn.length);
    expect(window.messages[1].toolCalls?.[0].id).toBe("call-1");
    expect(window.messages[2].content).toContain("older content omitted");
    expect(window.messages[3].content).toBe("done, memory usage is fine");
  });

  it("compacts oversized tool output but preserves its call pair", () => {
    const history: AiChatMessage[] = [
      user("diagnose"),
      {
        role: "assistant",
        toolCalls: [
          { id: "call-1", name: "read_terminal_output", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: "x".repeat(20_000) },
    ];
    const window = modelHistoryWindow(history, 500);

    expect(window.estimatedTokens).toBeLessThanOrEqual(500);
    expect(window.messages).toHaveLength(3);
    expect(window.messages[1].toolCalls?.[0].id).toBe("call-1");
    expect(window.messages[2].toolCallId).toBe("call-1");
    expect(window.messages[2].content).toContain("older content omitted");
    expect(history[2].content).toHaveLength(20_000);
  });
});
