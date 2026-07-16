import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    groups: { list: vi.fn() },
    hosts: { get: vi.fn(), list: vi.fn() },
    ssh: {
      disconnect: vi.fn(() => Promise.resolve()),
      send: vi.fn(() => Promise.resolve()),
    },
    sftp: {
      readText: vi.fn(() => Promise.resolve("")),
      writeText: vi.fn(() => Promise.resolve()),
    },
  },
}));

import type { TerminalPane, TerminalTab } from "@/workbench/tabs";
import { useTabsStore } from "@/workbench/tabs";
import {
  defaultTerminalOption,
  executeTool,
  newOutput,
  reusableHostSession,
  terminalTargetDisplay,
  terminalReadLineLimit,
} from "./tools";

function terminal(
  id: string,
  title: string,
  status: TerminalPane["status"] = "connected",
): TerminalPane {
  return {
    id,
    target: "ssh",
    hostId: `host-${id}`,
    title,
    status,
    attempt: 0,
  };
}

function tabOf(pane: TerminalPane): TerminalTab {
  return {
    kind: "terminal",
    id: pane.id,
    panes: [pane],
    layout: { type: "leaf", paneId: pane.id },
    activePaneId: pane.id,
  };
}

beforeEach(() => {
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastPaneId: null,
    pendingCloseId: null,
  });
});

describe("defaultTerminalOption", () => {
  const question = "你想查看哪台服务器的内存占用？";
  const options = ["DMIT CORONA（当前）", "10.10.30.56", "两台都查看"];

  it("selects the current connected terminal for an unspecified target", () => {
    const current = terminal("current-id", "DMIT CORONA");
    const other = terminal("other-id", "10.10.30.56");
    useTabsStore.setState({
      tabs: [tabOf(other), tabOf(current)],
      activeId: current.id,
      lastPaneId: current.id,
    });

    expect(
      defaultTerminalOption({ question, options }, "查看内存占用"),
    ).toEqual({ option: options[0], tab: current });
  });

  it("keeps an explicit multi-terminal request as a real choice", () => {
    const current = terminal("current-id", "DMIT CORONA");
    const other = terminal("other-id", "10.10.30.56");
    useTabsStore.setState({
      tabs: [tabOf(current), tabOf(other)],
      activeId: current.id,
      lastPaneId: current.id,
    });

    expect(
      defaultTerminalOption({ question, options }, "两台都查看内存占用"),
    ).toBeNull();
  });

  it("does not override an explicitly named different terminal", () => {
    const current = terminal("current-id", "DMIT CORONA");
    const other = terminal("other-id", "10.10.30.56");
    useTabsStore.setState({
      tabs: [tabOf(current), tabOf(other)],
      activeId: current.id,
      lastPaneId: current.id,
    });

    expect(
      defaultTerminalOption(
        { question, options },
        "查看 10.10.30.56 的内存占用",
      ),
    ).toBeNull();
  });

  it("does not override an explicitly named host that is not open yet", () => {
    const current = terminal("current-id", "DMIT CORONA");
    useTabsStore.setState({
      tabs: [tabOf(current)],
      activeId: current.id,
      lastPaneId: current.id,
    });

    expect(
      defaultTerminalOption(
        {
          question,
          options: ["DMIT CORONA（当前）", "Production API"],
        },
        "查看 Production API 的内存占用",
      ),
    ).toBeNull();
  });

  it("does not swallow non-terminal choices or disconnected targets", () => {
    const current = terminal("current-id", "DMIT CORONA", "closed");
    useTabsStore.setState({
      tabs: [tabOf(current)],
      activeId: current.id,
      lastPaneId: current.id,
    });

    expect(
      defaultTerminalOption(
        { question: "选择哪个修复方案？", options: ["方案 A", "方案 B"] },
        "修复它",
      ),
    ).toBeNull();
    expect(
      defaultTerminalOption({ question, options }, "查看内存占用"),
    ).toBeNull();
  });
});

describe("reusableHostSession", () => {
  it("prefers a live matching tab over stale duplicates", () => {
    const stale = terminal("stale", "Host", "closed");
    const live = terminal("live", "Host", "connected");
    stale.hostId = "same-host";
    live.hostId = "same-host";

    expect(reusableHostSession([tabOf(stale), tabOf(live)], "same-host")).toBe(
      live,
    );
  });

  it("returns a closed matching tab so it can be reconnected in place", () => {
    const stale = terminal("stale", "Host", "closed");
    stale.hostId = "same-host";

    expect(reusableHostSession([tabOf(stale)], "same-host")).toBe(stale);
  });
});

describe("terminal output helpers", () => {
  it("lists split panes separately and marks the focused pane", async () => {
    const left = terminal("left", "Production");
    const right = terminal("right", "Production");
    const split: TerminalTab = {
      kind: "terminal",
      id: "tab",
      panes: [left, right],
      layout: {
        type: "split",
        id: "split",
        direction: "row",
        children: [
          { type: "leaf", paneId: left.id },
          { type: "leaf", paneId: right.id },
        ],
        sizes: [0.5, 0.5],
      },
      activePaneId: right.id,
    };
    useTabsStore.setState({
      tabs: [split],
      activeId: split.id,
      lastPaneId: right.id,
    });

    const result = await executeTool("list_terminal_sessions", {});
    expect(JSON.parse(result.content)).toEqual([
      expect.objectContaining({ id: left.id, current: false, pane: "1/2" }),
      expect.objectContaining({ id: right.id, current: true, pane: "2/2" }),
    ]);
    expect(terminalTargetDisplay([split], right.id)).toEqual({
      title: "Production",
      paneIndex: 2,
      paneCount: 2,
    });
  });

  it("returns structured failures instead of inferring status from text", async () => {
    await expect(executeTool("read_terminal_output", {})).resolves.toEqual({
      content: expect.stringContaining("Error: no active terminal session"),
      isError: true,
    });
    await expect(executeTool("unknown_tool", {})).resolves.toEqual({
      content: 'Error: unknown tool "unknown_tool".',
      isError: true,
    });
  });

  it("accepts large reads but clamps them to the terminal safety limit", () => {
    expect(terminalReadLineLimit(undefined)).toBe(60);
    expect(terminalReadLineLimit(0)).toBe(1);
    expect(terminalReadLineLimit(1_500)).toBe(1_500);
    expect(terminalReadLineLimit(10_000)).toBe(2_000);
  });

  it("extracts consecutive pages from a file with thousands of lines", () => {
    const file = Array.from(
      { length: 5_000 },
      (_, index) => `line-${String(index + 1).padStart(4, "0")}`,
    );
    const recovered: string[] = [];

    for (let start = 0; start < file.length; start += 200) {
      const before = ["$ previous command", "previous output"].join("\n");
      const page = file.slice(start, start + 200);
      const after = [before, ...page].join("\n");
      recovered.push(...newOutput(before, after).split("\n"));
    }

    expect(recovered).toEqual(file);
  });

  it("recovers output after the terminal buffer drops older lines", () => {
    const before = ["old-1", "old-2", "overlap-1", "overlap-2"].join("\n");
    const after = ["overlap-1", "overlap-2", "new-1", "new-2"].join("\n");
    expect(newOutput(before, after)).toBe("new-1\nnew-2");
  });
});
