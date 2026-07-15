import { describe, expect, it } from "vitest";

import type { TerminalTab } from "@/workbench/tabs";
import { broadcastTargets } from "./broadcast";

function tab(
  id: string,
  target: TerminalTab["target"],
  status: TerminalTab["status"],
): TerminalTab {
  return {
    kind: "terminal",
    id,
    target,
    hostId: target === "ssh" ? `host-${id}` : "",
    title: id,
    status,
    attempt: 0,
  };
}

describe("broadcastTargets", () => {
  it("includes every other connected SSH and local terminal", () => {
    const tabs = [
      tab("source", "ssh", "connected"),
      tab("local", "local", "connected"),
      tab("adhoc", "ssh-adhoc", "connected"),
      tab("offline", "ssh", "closed"),
    ];

    expect(broadcastTargets(tabs, "source").map((item) => item.id)).toEqual([
      "local",
      "adhoc",
    ]);
  });

  it("does not broadcast input from a source that is not connected", () => {
    const tabs = [
      tab("source", "local", "connecting"),
      tab("remote", "ssh", "connected"),
    ];
    expect(broadcastTargets(tabs, "source")).toEqual([]);
  });
});
