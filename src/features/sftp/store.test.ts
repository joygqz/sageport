import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sftp: {
      home: vi.fn(() => Promise.resolve("/home/test")),
      list: vi.fn(() => Promise.resolve([])),
      transfer: vi.fn(() => Promise.resolve()),
      cancelTransfer: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.stubGlobal("localStorage", { getItem: vi.fn(() => "en") });

import { ipc } from "@/lib/ipc";
import { useToastStore } from "@/lib/toast";
import type { FileEntry, TransferEvent } from "@/types/models";
import {
  isValidEntryName,
  MAX_SFTP_TABS,
  parentPath,
  pathBaseName,
  useSftpStore,
  type SftpTab,
} from "./store";

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

  it("ignores a slower directory response after a newer navigation wins", async () => {
    let resolveSlow: ((entries: FileEntry[]) => void) | undefined;
    let resolveFast: ((entries: FileEntry[]) => void) | undefined;
    vi.mocked(ipc.sftp.list)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFast = resolve;
          }),
      );

    const slow = useSftpStore.getState().navigate("left", "local-tab", "/slow");
    const fast = useSftpStore.getState().navigate("left", "local-tab", "/fast");
    resolveFast?.([]);
    await fast;
    resolveSlow?.([]);
    await slow;

    const tab = useSftpStore.getState().panes.left.tabs[0];
    expect(tab?.cwd).toBe("/fast");
    expect(tab?.history.at(-1)).toBe("/fast");
  });
});

describe("SFTP path and name helpers", () => {
  it("finds parent folders without escaping POSIX, drive, or UNC roots", () => {
    expect(parentPath("/home/test/")).toBe("/home");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("C:\\Users\\test")).toBe("C:\\Users");
    expect(parentPath("C:\\")).toBe("C:\\");
    expect(parentPath("\\\\server\\share\\folder")).toBe("\\\\server\\share\\");
    expect(parentPath("\\\\server\\share\\")).toBe("\\\\server\\share\\");
  });

  it("derives bookmark labels from POSIX and Windows paths", () => {
    expect(pathBaseName("/home/test/")).toBe("test");
    expect(pathBaseName("C:\\Users\\test\\")).toBe("test");
  });

  it("rejects path traversal and overlong inline names", () => {
    expect(isValidEntryName("report.txt")).toBe(true);
    expect(isValidEntryName("..")).toBe(false);
    expect(isValidEntryName("nested/file")).toBe(false);
    expect(isValidEntryName("nested\\file")).toBe(false);
    expect(isValidEntryName("x".repeat(256))).toBe(false);
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

describe("SFTP tab limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useSftpStore.setState({
      panes: {
        left: {
          tabs: Array.from({ length: MAX_SFTP_TABS - 1 }, (_, i) =>
            transferTab(`left-${i}`, null, `/left-${i}`),
          ),
          activeTabId: "left-0",
        },
        right: {
          tabs: [transferTab("right-0", "remote-0", "/right")],
          activeTabId: "right-0",
        },
      },
      transfers: {},
    });
  });

  it("counts tabs across both panes and rejects tabs over the limit", async () => {
    await useSftpStore.getState().addLocalTab("right");

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.length + right.tabs.length).toBe(MAX_SFTP_TABS);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("allows another tab after one is closed", async () => {
    useSftpStore.getState().closeTab("left", "left-0");
    await useSftpStore.getState().addLocalTab("left");

    const { left, right } = useSftpStore.getState().panes;
    expect(left.tabs.length + right.tabs.length).toBe(MAX_SFTP_TABS);
  });

  it("silently skips repeated automatic initialization at the limit", async () => {
    useSftpStore.setState({
      panes: {
        left: { tabs: [], activeTabId: null },
        right: {
          tabs: Array.from({ length: MAX_SFTP_TABS }, (_, i) =>
            transferTab(`right-${i}`, `remote-${i}`, `/right-${i}`),
          ),
          activeTabId: "right-0",
        },
      },
    });

    await Promise.all([
      useSftpStore.getState().ensureLocalTab("left"),
      useSftpStore.getState().ensureLocalTab("left"),
    ]);

    expect(useSftpStore.getState().panes.left.tabs).toHaveLength(0);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(ipc.sftp.home).not.toHaveBeenCalled();
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
