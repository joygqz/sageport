import { describe, expect, it } from "vitest";

import type { TerminalPane } from "@/workbench/tabs";
import { terminalConnectionTarget } from "./connection-display";

function pane(patch: Partial<TerminalPane> = {}): TerminalPane {
  return {
    id: "pane-1",
    target: "ssh",
    hostId: "host-1",
    title: "Production",
    status: "connecting",
    attempt: 0,
    ...patch,
  };
}

describe("terminalConnectionTarget", () => {
  it("formats a saved host with its login and port", () => {
    expect(
      terminalConnectionTarget(pane(), {
        address: "69.63.195.54",
        port: 22,
        username: "root",
      }),
    ).toBe("root@69.63.195.54:22");
  });

  it("uses the ad hoc target and brackets IPv6 addresses", () => {
    expect(
      terminalConnectionTarget(
        pane({
          target: "ssh-adhoc",
          hostId: "",
          adhoc: { host: "2001:db8::1", port: 2222, username: "deploy" },
        }),
      ),
    ).toBe("deploy@[2001:db8::1]:2222");
  });

  it("returns null while saved host details are unavailable", () => {
    expect(terminalConnectionTarget(pane())).toBeNull();
  });
});
