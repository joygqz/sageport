import { beforeEach, describe, expect, it } from "vitest";

import { useSftpStore, type SftpTab } from "./store";

const loadedTab = (): SftpTab => ({
  id: "local-tab",
  kind: "local",
  connectionId: null,
  title: "Local",
  cwd: "/root",
  navigationPath: "/root/1",
  status: "connected",
  entries: [],
  selected: [],
  history: ["/", "/root"],
  historyIndex: 1,
  loading: false,
  error: "Path does not exist: /root/1",
});

describe("SFTP navigation state", () => {
  beforeEach(() => {
    useSftpStore.setState((state) => ({
      panes: {
        ...state.panes,
        left: { tabs: [loadedTab()], activeTabId: "local-tab" },
      },
    }));
  });

  it("returns from a failed path to the last loaded path before using history", () => {
    useSftpStore.getState().restoreLoadedPath("left", "local-tab");

    const tab = useSftpStore.getState().panes.left.tabs[0];
    expect(tab).toMatchObject({
      cwd: "/root",
      history: ["/", "/root"],
      historyIndex: 1,
    });
    expect(tab?.navigationPath).toBeUndefined();
    expect(tab?.error).toBeUndefined();
  });
});
