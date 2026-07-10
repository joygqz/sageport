import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "@/types/models";
import {
  buildLogFromHistory,
  completedToolStatus,
  INTERRUPTED_RESULT,
  repairHistory,
  truncateToolResult,
} from "./transcript";

describe("completedToolStatus", () => {
  it("marks tool-returned errors as errors in the live transcript", () => {
    expect(completedToolStatus("Error: no active terminal session.")).toBe(
      "error",
    );
    expect(completedToolStatus("command output")).toBe("done");
    expect(completedToolStatus("Error: literal command output", false)).toBe(
      "done",
    );
  });
});

describe("truncateToolResult", () => {
  it("keeps short results intact", () => {
    const text = "x".repeat(32_000);
    expect(truncateToolResult(text)).toBe(text);
  });

  it("keeps head and tail of oversized results", () => {
    const text = `HEAD${"x".repeat(50_000)}TAIL`;
    const truncated = truncateToolResult(text);

    expect(truncated.length).toBeLessThan(33_000);
    expect(truncated.startsWith("HEAD")).toBe(true);
    expect(truncated.endsWith("TAIL")).toBe(true);
    expect(truncated).toContain("characters omitted");
  });
});

describe("repairHistory", () => {
  it("appends interrupted results for dangling tool calls", () => {
    const history: AiChatMessage[] = [
      { role: "user", content: "check disk usage" },
      {
        role: "assistant",
        toolCalls: [
          { id: "call-1", name: "run_terminal_command", arguments: {} },
          { id: "call-2", name: "read_terminal_output", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: "ok" },
    ];

    const repaired = repairHistory(history);

    expect(repaired).toHaveLength(4);
    expect(repaired[2]).toBe(history[2]);
    expect(repaired[3]).toEqual({
      role: "tool",
      toolCallId: "call-2",
      content: INTERRUPTED_RESULT,
      toolError: false,
    });
  });

  it("leaves complete histories untouched", () => {
    const history: AiChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(repairHistory(history)).toEqual(history);
  });
});

describe("buildLogFromHistory", () => {
  it("rebuilds tool status from persisted results", () => {
    const history: AiChatMessage[] = [
      { role: "user", content: "list files" },
      {
        role: "assistant",
        toolCalls: [
          { id: "call-1", name: "run_terminal_command", arguments: {} },
          { id: "call-2", name: "run_terminal_command", arguments: {} },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: "Error: boom" },
      { role: "tool", toolCallId: "call-2", content: INTERRUPTED_RESULT },
      { role: "assistant", content: "done" },
    ];

    const log = buildLogFromHistory(history);
    const tools = log.filter((item) => item.kind === "tool");

    expect(log[0]).toMatchObject({ kind: "user", content: "list files" });
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ status: "error", result: "Error: boom" });
    expect(tools[1]).toMatchObject({ status: "denied" });
    expect(log.at(-1)).toMatchObject({ kind: "assistant", content: "done" });
  });
});
