import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "@/types/models";
import {
  estimateMessageTokens,
  estimateTextTokens,
  modelHistoryWindow,
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
