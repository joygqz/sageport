import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

import {
  registerSession,
  unregisterSession,
} from "@/features/terminal/sessions";
import type { TerminalSession } from "@/features/terminal/session";
import { useTabsStore, type TerminalTab } from "@/workbench/tabs";
import { executeTool, prepareTool } from "./registry";

const sendCommand = vi.fn();
let output = "user@host:~$ ";

function terminal(id: string): TerminalTab {
  return {
    id,
    kind: "terminal",
    panes: [
      {
        id,
        title: id,
        target: "ssh",
        hostId: id,
        status: "connected",
        attempt: 0,
      },
    ],
    activePaneId: id,
    layout: { type: "leaf", paneId: id },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  sendCommand.mockReset();
  output = "user@host:~$ ";
  useTabsStore.setState({
    tabs: [terminal("first"), terminal("second")],
    activeId: "first",
    lastPaneId: "first",
  });
  registerSession("first", {
    sendCommand,
    readContext: () => output,
  } as unknown as TerminalSession);
});

afterEach(() => {
  unregisterSession("first");
  vi.useRealTimers();
});

describe("terminal operation boundaries", () => {
  it.each([
    "read_terminal_output",
    "send_terminal_input",
    "split_terminal",
    "close_terminal",
    "focus_terminal",
    "reconnect_terminal",
  ])("pins %s before approval", async (name) => {
    const prepared = await prepareTool(name, {}, { userPrompt: "" });
    useTabsStore.getState().focusPane("second");
    expect(prepared.args.sessionId).toBe("first");
  });

  it("does not start a command after cancellation", async () => {
    const result = await executeTool(
      "run_terminal_command",
      { command: "uptime" },
      { isCancelled: () => true },
    );
    expect(result.isError).toBe(true);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not turn a timeout into a successful command exit", async () => {
    sendCommand.mockImplementation(() => {
      output += "sleep 30\n";
    });
    const pending = executeTool("run_terminal_command", {
      command: "sleep 30",
      timeoutMs: 1000,
    });
    await vi.runAllTimersAsync();
    const result = JSON.parse((await pending).content);
    expect(result).toMatchObject({ observation: "timed-out", exitCode: null });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a prompt as an observation without inventing an exit code", async () => {
    sendCommand.mockImplementation(() => {
      output += "false\nuser@host:~$ ";
    });
    const pending = executeTool("run_terminal_command", { command: "false" });
    await vi.runAllTimersAsync();
    expect(JSON.parse((await pending).content)).toMatchObject({
      observation: "prompt-observed",
      exitCode: null,
    });
  });

  it("fails interactive input when the terminal has been disposed", async () => {
    const result = await executeTool("send_terminal_input", {
      sessionId: "second",
      data: "y\r",
    });
    expect(result.isError).toBe(true);
  });
});
