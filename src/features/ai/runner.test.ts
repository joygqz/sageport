import { beforeEach, describe, expect, it, vi } from "vitest";

const { chat, modelLimits } = vi.hoisted(() => ({
  chat: vi.fn(),
  modelLimits: vi.fn(),
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
});
