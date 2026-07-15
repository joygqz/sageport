import { beforeEach, describe, expect, it, vi } from "vitest";

const { chat, modelLimits, executeTool } = vi.hoisted(() => ({
  chat: vi.fn(),
  modelLimits: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ai: { chat, modelLimits },
    groups: { list: vi.fn() },
    hosts: { get: vi.fn(), list: vi.fn() },
  },
}));

vi.mock("@/i18n/config", () => ({ detectLocale: () => "en" }));
vi.mock("@/i18n/translate", () => ({
  translate: (_locale: string, key: string) => key,
}));

vi.mock("./tools", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, executeTool };
});

import { clearModelLimitsCache } from "./model-limits";
import { runAgentLoop, type RunnerHost } from "./runner";
import type { RuntimeSession } from "./transcript";
import { useTabsStore } from "@/workbench/tabs";

function runtime(): RuntimeSession {
  return {
    history: [{ role: "user", content: "hello" }],
    log: [{ id: "user", kind: "user", content: "hello" }],
    pending: true,
    activity: null,
    requestId: null,
    stopRequested: false,
    stepLimitReached: false,
    contextTokens: null,
    contextWindow: null,
    summary: "",
    summaryUpTo: 0,
  };
}

function harness(initial = runtime()) {
  let current = initial;
  const persist = vi.fn(() => Promise.resolve());
  const host: RunnerHost = {
    runtime: () => current,
    patch: (_sessionId, update) => {
      current = update(current);
    },
    persist,
    requestApproval: vi.fn(() => Promise.resolve(false)),
    requestAnswer: vi.fn(() => Promise.resolve(null)),
  };
  return { host, persist, state: () => current };
}

beforeEach(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
  clearModelLimitsCache();
  chat.mockReset();
  modelLimits.mockReset();
  executeTool.mockReset();
  modelLimits.mockResolvedValue({
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
  });
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastTerminalId: null,
    pendingCloseId: null,
  });
});

describe("runAgentLoop", () => {
  it("sends only core tools by default", async () => {
    chat.mockResolvedValue({ content: "done" });
    const run = harness();

    await runAgentLoop(run.host, "session", "model");

    const toolNames = chat.mock.calls[0][2].map(
      (tool: { name: string }) => tool.name,
    );
    expect(toolNames).toEqual([
      "ask_user",
      "list_terminal_sessions",
      "read_terminal_output",
      "run_terminal_command",
    ]);
  });

  it("adds selected optional tools and rejects disabled tool calls", async () => {
    chat
      .mockResolvedValueOnce({
        toolCalls: [
          { id: "call-1", name: "list_hosts", arguments: {} },
          { id: "call-2", name: "list_snippets", arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ content: "done" });
    executeTool.mockResolvedValue({ content: "hosts", isError: false });
    const run = harness();

    await runAgentLoop(run.host, "session", "model", false, ["list_hosts"]);

    expect(chat.mock.calls[0][2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "list_hosts" })]),
    );
    expect(chat.mock.calls[0][2]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "list_snippets" }),
      ]),
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      "list_hosts",
      {},
      expect.any(Object),
    );
    expect(run.state().history).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-2",
        toolError: true,
        content: expect.stringContaining("disabled in AI settings"),
      }),
    );
  });

  it("commits the provider result and clears the active request id", async () => {
    chat.mockImplementation(
      async (
        _model: string,
        _messages: unknown,
        _tools: unknown,
        opts: { onDelta?: (text: string) => void },
      ) => {
        opts.onDelta?.("streamed");
        return { content: "final answer" };
      },
    );
    const run = harness();

    await runAgentLoop(run.host, "session", "model");

    expect(run.state().requestId).toBeNull();
    expect(run.state().history.at(-1)).toMatchObject({
      role: "assistant",
      content: "final answer",
    });
    expect(run.state().log.at(-1)).toMatchObject({
      kind: "assistant",
      content: "final answer",
    });
    expect(run.persist).toHaveBeenCalledTimes(1);
  });

  it("ignores late deltas after stop and preserves the partial response", async () => {
    const run = harness();
    chat.mockImplementation(
      async (
        _model: string,
        _messages: unknown,
        _tools: unknown,
        opts: { onDelta?: (text: string) => void },
      ) => {
        opts.onDelta?.("kept");
        run.host.patch("session", (state) => ({
          ...state,
          stopRequested: true,
        }));
        opts.onDelta?.("discarded");
        return { content: "provider finished too late" };
      },
    );

    await runAgentLoop(run.host, "session", "model");

    expect(run.state().log.at(-1)).toMatchObject({ content: "kept" });
    expect(run.state().history.at(-1)).toMatchObject({
      role: "assistant",
      content: "kept",
    });
    expect(run.state().requestId).toBeNull();
  });

  it("stops promptly while model limits are still loading", async () => {
    let resolveLimits!: (value: {
      contextWindow: number;
      maxOutputTokens: number;
    }) => void;
    modelLimits.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLimits = resolve;
        }),
    );
    const run = harness();

    const pending = runAgentLoop(run.host, "session", "slow-model");
    await Promise.resolve();
    run.host.patch("session", (state) => ({
      ...state,
      stopRequested: true,
    }));
    await pending;
    resolveLimits({ contextWindow: 128_000, maxOutputTokens: 16_000 });

    expect(chat).not.toHaveBeenCalled();
  });

  it("never executes a terminal command after approval is denied", async () => {
    useTabsStore.setState({
      tabs: [
        {
          kind: "terminal",
          id: "terminal-1",
          target: "ssh",
          hostId: "host-1",
          title: "Production",
          status: "connected",
          attempt: 0,
        },
      ],
      activeId: "terminal-1",
      lastTerminalId: "terminal-1",
    });
    chat
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: "call-1",
            name: "run_terminal_command",
            arguments: { command: "rm -rf /important" },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "The command was not run." });
    const run = harness();

    await runAgentLoop(run.host, "session", "model");

    expect(run.host.requestApproval).toHaveBeenCalledTimes(1);
    expect(
      run
        .state()
        .history.find(
          (message) =>
            message.role === "tool" && message.toolCallId === "call-1",
        ),
    ).toMatchObject({
      content: "The user declined to run this command.",
      toolError: false,
    });
  });

  it("executes approval-required tools immediately in autonomous mode", async () => {
    useTabsStore.setState({
      tabs: [
        {
          kind: "terminal",
          id: "terminal-1",
          target: "ssh",
          hostId: "host-1",
          title: "Production",
          status: "connected",
          attempt: 0,
        },
      ],
      activeId: "terminal-1",
      lastTerminalId: "terminal-1",
    });
    chat
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: "call-1",
            name: "run_terminal_command",
            arguments: { command: "uptime" },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Done." });
    executeTool.mockResolvedValue({
      content: "load average: 0.1",
      isError: false,
    });
    const run = harness();

    await runAgentLoop(run.host, "session", "model", true);

    expect(run.host.requestApproval).not.toHaveBeenCalled();
    expect(executeTool).toHaveBeenCalledWith(
      "run_terminal_command",
      { command: "uptime", sessionId: "terminal-1" },
      expect.any(Object),
    );
    expect(run.state().log).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        toolCallId: "call-1",
        status: "done",
      }),
    );
  });

  it("rejects an answer that was not offered by ask_user", async () => {
    chat
      .mockResolvedValueOnce({
        toolCalls: [
          {
            id: "call-question",
            name: "ask_user",
            arguments: {
              question: "Choose a region",
              options: ["east", "west"],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "handled" });
    const run = harness();
    run.host.requestAnswer = vi.fn(() => Promise.resolve("forged"));

    await runAgentLoop(run.host, "session", "model");

    expect(run.state().history).toContainEqual(
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-question",
        toolError: true,
        content: expect.stringContaining("not one of the offered options"),
      }),
    );
  });

  it("records provider usage and the model context window", async () => {
    chat.mockResolvedValue({
      content: "done",
      usage: { inputTokens: 4321, outputTokens: 100 },
    });
    const run = harness();

    await runAgentLoop(run.host, "session", "model");

    expect(run.state().contextTokens).toBe(4321);
    expect(run.state().contextWindow).toBe(128_000);
  });

  it("retries with a smaller window on a context-length error", async () => {
    chat
      .mockRejectedValueOnce({ code: "context_length", message: "too long" })
      .mockResolvedValueOnce({ content: "ok" });
    const run = harness();

    await runAgentLoop(run.host, "session", "model");

    expect(chat).toHaveBeenCalledTimes(2);
    expect(run.state().history.at(-1)).toMatchObject({
      role: "assistant",
      content: "ok",
    });
    expect(run.state().requestId).toBeNull();
  });

  it("summarizes overflowed older turns and injects the summary", async () => {
    modelLimits.mockResolvedValue({
      contextWindow: 2_000,
      maxOutputTokens: 500,
    });
    const initial = runtime();
    initial.history = [
      { role: "user", content: `first question ${"x".repeat(4_000)}` },
      { role: "assistant", content: `first answer ${"x".repeat(4_000)}` },
      { role: "user", content: `second question ${"y".repeat(4_000)}` },
    ];
    const run = harness(initial);
    chat
      .mockResolvedValueOnce({ content: "SUMMARY: earlier context" })
      .mockResolvedValueOnce({ content: "final" });

    await runAgentLoop(run.host, "session", "model");

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[0][2]).toEqual([]);
    expect(chat.mock.calls[0][1][0].content).toContain("fold into the summary");
    expect(run.state().summary).toBe("SUMMARY: earlier context");
    expect(run.state().summaryUpTo).toBe(2);
    expect(chat.mock.calls[1][3].context).toContain("SUMMARY: earlier context");
  });

  it("flags the step limit instead of appending filler text", async () => {
    chat.mockResolvedValue({
      toolCalls: [
        { id: "loop", name: "list_terminal_sessions", arguments: {} },
      ],
    });
    executeTool.mockResolvedValue({ content: "sessions", isError: false });
    const run = harness();

    await runAgentLoop(run.host, "session", "model", true);

    expect(chat).toHaveBeenCalledTimes(24);
    expect(run.state().stepLimitReached).toBe(true);
    expect(
      run.state().history.some((m) => m.role === "assistant" && !m.toolCalls),
    ).toBe(false);
  });
});
