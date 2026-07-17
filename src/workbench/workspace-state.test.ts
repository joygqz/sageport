import { describe, expect, it } from "vitest";

import {
  readWorkspace,
  WORKSPACE_STORAGE_KEY,
  writeWorkspace,
} from "./workspace-state";

describe("workspace state", () => {
  it("restores terminal metadata without reconnecting or persisting output", () => {
    let raw = "";
    const tab = {
      kind: "terminal" as const,
      id: "tab-1",
      panes: [
        {
          id: "pane-1",
          target: "ssh" as const,
          hostId: "host-1",
          title: "Prod",
          status: "connected" as const,
          attempt: 4,
        },
      ],
      layout: { type: "leaf" as const, paneId: "pane-1" },
      activePaneId: "pane-1",
    };
    writeWorkspace(
      {
        setItem: (_key, value) => {
          raw = value;
        },
      },
      { tabs: [tab], activeId: tab.id, lastPaneId: "pane-1" },
    );
    const restored = readWorkspace({
      getItem: (key) => (key === WORKSPACE_STORAGE_KEY ? raw : null),
    });
    expect(restored.tabs[0]?.panes[0]).toMatchObject({
      status: "closed",
      attempt: 0,
      restorePending: true,
    });
    expect(raw).not.toContain("connected");
  });

  it("rejects malformed layouts", () => {
    const restored = readWorkspace({
      getItem: () =>
        JSON.stringify({
          version: 1,
          tabs: [{ kind: "terminal", id: "x", panes: [], layout: null }],
        }),
    });
    expect(restored.tabs).toEqual([]);
  });

  it("rejects malformed ad-hoc targets", () => {
    const restored = readWorkspace({
      getItem: () =>
        JSON.stringify({
          version: 1,
          tabs: [
            {
              kind: "terminal",
              id: "x",
              panes: [
                {
                  id: "p",
                  target: "ssh-adhoc",
                  hostId: "adhoc",
                  title: "Bad",
                  adhoc: { host: "example.com", port: 70000 },
                },
              ],
              layout: { type: "leaf", paneId: "p" },
              activePaneId: "p",
            },
          ],
        }),
    });
    expect(restored.tabs).toEqual([]);
  });
});
