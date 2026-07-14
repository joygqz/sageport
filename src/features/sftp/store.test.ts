import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sftp: {
      list: vi.fn(() => Promise.resolve([])),
      transfer: vi.fn(() => Promise.resolve()),
      cancelTransfer: vi.fn(() => Promise.resolve()),
    },
  },
}));

import { ipc } from "@/lib/ipc";
import type { FileEntry, TransferEvent } from "@/types/models";
import { useSftpStore, type SftpTab } from "./store";

const refreshDirectory = useSftpStore.getState().refresh;

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
    vi.clearAllMocks();
    useSftpStore.setState({
      panes: {
        left: { tabs: [loadedTab()], activeTabId: "local-tab" },
        right: { tabs: [], activeTabId: null },
      },
      transfers: {},
      refresh: refreshDirectory,
    });
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

describe("SFTP tab ordering", () => {
  beforeEach(() => {
    const leftTabs = [
      transferTab("left-a", null, "/a"),
      transferTab("left-b", null, "/b"),
      transferTab("left-c", null, "/c"),
    ];
    useSftpStore.setState({
      panes: {
        left: { tabs: leftTabs, activeTabId: "left-b" },
        right: {
          tabs: [transferTab("right-a", null, "/right")],
          activeTabId: "right-a",
        },
      },
      transfers: {},
    });
  });

  it("reorders tabs only within the requested pane", () => {
    const originalActive = useSftpStore.getState().panes.left.tabs[1];

    useSftpStore.getState().moveTab("left", "left-a", 2);

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.map((tab) => tab.id)).toEqual([
      "left-b",
      "left-c",
      "left-a",
    ]);
    expect(left.activeTabId).toBe("left-b");
    expect(left.tabs[0]).toBe(originalActive);
    expect(right.tabs.map((tab) => tab.id)).toEqual(["right-a"]);
  });

  it("clamps the destination and ignores unknown tabs", () => {
    useSftpStore.getState().moveTab("left", "left-a", 100);
    expect(
      useSftpStore.getState().panes.left.tabs.map((tab) => tab.id),
    ).toEqual(["left-b", "left-c", "left-a"]);

    useSftpStore.getState().moveTab("left", "missing", 0);
    expect(
      useSftpStore.getState().panes.left.tabs.map((tab) => tab.id),
    ).toEqual(["left-b", "left-c", "left-a"]);
  });
});

function transferTab(
  id: string,
  connectionId: string | null,
  cwd: string,
): SftpTab {
  return {
    id,
    kind: connectionId ? "remote" : "local",
    connectionId,
    title: id,
    cwd,
    status: "connected",
    entries: [],
    selected: [],
    history: [cwd],
    historyIndex: 0,
    loading: false,
  };
}

describe("SFTP transfer refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSftpStore.setState({
      panes: {
        left: {
          tabs: [
            transferTab("left-target", null, "/downloads"),
            transferTab("left-other", null, "/documents"),
          ],
          activeTabId: "left-target",
        },
        right: {
          tabs: [transferTab("right-source", "remote-1", "/uploads")],
          activeTabId: "right-source",
        },
      },
      transfers: {},
      refresh: refreshDirectory,
    });
  });

  it("refreshes only the original destination tab after a right-to-left transfer", async () => {
    const entry: FileEntry = {
      name: "report.pdf",
      path: "/uploads/report.pdf",
      kind: "file",
      size: 42,
      modified: null,
      permissions: null,
      isSymlink: false,
    };

    await useSftpStore.getState().transfer("right", [entry]);

    expect(ipc.sftp.transfer).toHaveBeenCalledOnce();
    const [transferId] = vi.mocked(ipc.sftp.transfer).mock.calls[0];
    useSftpStore.getState().setActive("left", "left-other");
    const refresh = vi.fn(() => Promise.resolve());
    useSftpStore.setState({ refresh });

    const completed: TransferEvent = {
      transferId,
      transferred: entry.size,
      total: entry.size,
      file: entry.name,
      status: "done",
    };
    useSftpStore.getState().applyTransfer(completed);

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith("left", "left-target");
  });
});
