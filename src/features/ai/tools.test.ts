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

import type { TerminalTab } from "@/workbench/tabs";
import { useTabsStore } from "@/workbench/tabs";
import { defaultTerminalOption, reusableHostSession } from "./tools";

function terminal(
  id: string,
  title: string,
  status: TerminalTab["status"] = "connected",
): TerminalTab {
  return {
    kind: "terminal",
    id,
    target: "ssh",
    hostId: `host-${id}`,
    title,
    status,
    attempt: 0,
  };
}

beforeEach(() => {
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastTerminalId: null,
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
      tabs: [other, current],
      activeId: current.id,
      lastTerminalId: current.id,
    });

    expect(
      defaultTerminalOption({ question, options }, "查看内存占用"),
    ).toEqual({ option: options[0], tab: current });
  });

  it("keeps an explicit multi-terminal request as a real choice", () => {
    const current = terminal("current-id", "DMIT CORONA");
    const other = terminal("other-id", "10.10.30.56");
    useTabsStore.setState({
      tabs: [current, other],
      activeId: current.id,
      lastTerminalId: current.id,
    });

    expect(
      defaultTerminalOption({ question, options }, "两台都查看内存占用"),
    ).toBeNull();
  });

  it("does not override an explicitly named different terminal", () => {
    const current = terminal("current-id", "DMIT CORONA");
    const other = terminal("other-id", "10.10.30.56");
    useTabsStore.setState({
      tabs: [current, other],
      activeId: current.id,
      lastTerminalId: current.id,
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
      tabs: [current],
      activeId: current.id,
      lastTerminalId: current.id,
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
      tabs: [current],
      activeId: current.id,
      lastTerminalId: current.id,
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

    expect(reusableHostSession([stale, live], "same-host")).toBe(live);
  });

  it("returns a closed matching tab so it can be reconnected in place", () => {
    const stale = terminal("stale", "Host", "closed");
    stale.hostId = "same-host";

    expect(reusableHostSession([stale], "same-host")).toBe(stale);
  });
});
