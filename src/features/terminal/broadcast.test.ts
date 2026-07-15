import { describe, expect, it } from "vitest";

import type { TerminalPane } from "@/workbench/tabs";
import { broadcastTargets } from "./broadcast";

function pane(
  id: string,
  target: TerminalPane["target"],
  status: TerminalPane["status"],
): TerminalPane {
  return {
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
    const panes = [
      pane("source", "ssh", "connected"),
      pane("local", "local", "connected"),
      pane("adhoc", "ssh-adhoc", "connected"),
      pane("offline", "ssh", "closed"),
    ];

    expect(broadcastTargets(panes, "source").map((item) => item.id)).toEqual([
      "local",
      "adhoc",
    ]);
  });

  it("does not broadcast input from a source that is not connected", () => {
    const panes = [
      pane("source", "local", "connecting"),
      pane("remote", "ssh", "connected"),
    ];
    expect(broadcastTargets(panes, "source")).toEqual([]);
  });
});
