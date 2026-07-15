import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ssh: {
      disconnect: vi.fn(() => Promise.resolve()),
      send: vi.fn(() => Promise.resolve()),
    },
    pty: {
      close: vi.fn(() => Promise.resolve()),
    },
    sftp: {
      readText: vi.fn(() => new Promise(() => {})),
      writeText: vi.fn(() => Promise.resolve()),
    },
    history: {
      add: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.stubGlobal("localStorage", { getItem: vi.fn(() => "en") });

import { ipc } from "@/lib/ipc";
import {
  registerSession,
  unregisterSession,
} from "@/features/terminal/sessions";
import type { TerminalSession } from "@/features/terminal/session";
import { layoutPaneIds } from "./pane-layout";
import {
  isFileDirty,
  MAX_FILE_TABS,
  MAX_TERMINAL_SESSIONS,
  paneTab,
  targetPaneId,
  terminalPanes,
  terminalTabs,
  useTabsStore,
} from "./tabs";
import type { FileTab } from "./tabs";

const host = (id: string) => ({ id, label: `host-${id}` });

function openHost(id: string): string {
  const paneId = useTabsStore.getState().openTerminal(host(id));
  if (!paneId) throw new Error("Expected terminal tab to open");
  return paneId;
}

function tabIdOf(paneId: string): string {
  const tab = paneTab(useTabsStore.getState().tabs, paneId);
  if (!tab) throw new Error(`Expected a tab containing pane ${paneId}`);
  return tab.id;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ipc.sftp.writeText).mockResolvedValue(undefined);
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastPaneId: null,
    pendingCloseId: null,
    pendingWindowClose: false,
  });
});

describe("openTerminal", () => {
  it("appends the tab, activates it, and tracks its pane as last pane", () => {
    const paneId = openHost("a");
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(tabIdOf(paneId));
    expect(s.lastPaneId).toBe(paneId);
  });

  it("rejects new terminal sessions after reaching the limit", () => {
    const store = useTabsStore.getState();
    for (let i = 0; i < MAX_TERMINAL_SESSIONS; i++) {
      expect(store.openTerminal(host(String(i)))).not.toBeNull();
    }

    expect(store.openLocalTerminal()).toBeNull();
    expect(useTabsStore.getState().tabs).toHaveLength(MAX_TERMINAL_SESSIONS);
  });

  it("allows another terminal after one is closed", () => {
    const store = useTabsStore.getState();
    const ids = Array.from({ length: MAX_TERMINAL_SESSIONS }, (_, i) =>
      openHost(String(i)),
    );

    store.close(ids[0]!);

    expect(
      store.openAdhocTerminal({
        host: "example.com",
        port: 22,
        username: "me",
      }),
    ).not.toBeNull();
    expect(useTabsStore.getState().tabs).toHaveLength(MAX_TERMINAL_SESSIONS);
  });
});

describe("splitPane", () => {
  it("clones the source connection into a sibling pane and focuses it", () => {
    const source = openHost("a");
    const split = useTabsStore.getState().splitPane(source, "right");

    expect(split).not.toBeNull();
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    const tab = terminalTabs(s.tabs)[0];
    expect(tab.panes).toHaveLength(2);
    expect(tab.activePaneId).toBe(split);
    expect(s.lastPaneId).toBe(split);
    expect(layoutPaneIds(tab.layout)).toEqual([source, split]);
    const clone = tab.panes.find((pane) => pane.id === split)!;
    expect(clone).toMatchObject({
      target: "ssh",
      hostId: "a",
      title: "host-a",
      status: "idle",
      attempt: 0,
    });
  });

  it("counts panes toward the session limit", () => {
    const roots = Array.from({ length: MAX_TERMINAL_SESSIONS / 2 }, (_, i) =>
      openHost(String(i)),
    );
    for (const root of roots) {
      expect(useTabsStore.getState().splitPane(root, "right")).not.toBeNull();
    }
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(
      MAX_TERMINAL_SESSIONS,
    );
    expect(useTabsStore.getState().splitPane(roots[0]!, "down")).toBeNull();
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(
      MAX_TERMINAL_SESSIONS,
    );
  });

  it("limits horizontal splits to three panes", () => {
    const first = openHost("a");
    const second = useTabsStore.getState().splitPane(first, "right")!;
    const third = useTabsStore.getState().splitPane(second, "right")!;
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(3);

    expect(useTabsStore.getState().splitPane(third, "right")).toBeNull();
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(3);
  });

  it("limits vertical splits to two panes", () => {
    const first = openHost("a");
    const second = useTabsStore.getState().splitPane(first, "down")!;
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(2);

    expect(useTabsStore.getState().splitPane(second, "down")).toBeNull();
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(2);
  });

  it("allows a nested vertical split inside a full horizontal row", () => {
    const first = openHost("a");
    const second = useTabsStore.getState().splitPane(first, "right")!;
    useTabsStore.getState().splitPane(second, "right");
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(3);

    expect(useTabsStore.getState().splitPane(second, "down")).not.toBeNull();
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(4);
  });

  it("blocks a nested split that would widen the grid past the column cap", () => {
    const first = openHost("a");
    const second = useTabsStore.getState().splitPane(first, "right")!;
    useTabsStore.getState().splitPane(second, "right");
    const nested = useTabsStore.getState().splitPane(second, "down")!;
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(4);

    // Splitting the nested pane sideways would make the bottom band 4 wide.
    expect(useTabsStore.getState().splitPane(nested, "right")).toBeNull();
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(4);
  });

  it("permits building a full 3x2 grid but no further", () => {
    const cols = [openHost("a")];
    cols.push(useTabsStore.getState().splitPane(cols[0]!, "right")!);
    cols.push(useTabsStore.getState().splitPane(cols[1]!, "right")!);
    for (const col of cols) {
      expect(useTabsStore.getState().splitPane(col, "down")).not.toBeNull();
    }
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(6);

    for (const col of cols) {
      expect(useTabsStore.getState().splitPane(col, "down")).toBeNull();
      expect(useTabsStore.getState().splitPane(col, "right")).toBeNull();
    }
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(6);
  });
});

describe("closePane", () => {
  it("collapses back to a single pane and refocuses the neighbor", () => {
    const source = openHost("a");
    const split = useTabsStore.getState().splitPane(source, "right")!;

    useTabsStore.getState().closePane(split);

    const s = useTabsStore.getState();
    const tab = terminalTabs(s.tabs)[0];
    expect(tab.panes.map((pane) => pane.id)).toEqual([source]);
    expect(tab.layout).toEqual({ type: "leaf", paneId: source });
    expect(tab.activePaneId).toBe(source);
    expect(s.lastPaneId).toBe(source);
  });

  it("closes the whole tab when the last pane closes", () => {
    const source = openHost("a");
    useTabsStore.getState().closePane(source);
    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(ipc.ssh.disconnect).toHaveBeenCalledWith(source, 0);
  });
});

describe("focusPane", () => {
  it("focusPaneNext cycles panes in layout order", () => {
    const a = openHost("a");
    const b = useTabsStore.getState().splitPane(a, "right")!;
    const c = useTabsStore.getState().splitPane(b, "down")!;

    useTabsStore.getState().focusPaneNext(1);
    expect(paneTab(useTabsStore.getState().tabs, a)!.activePaneId).toBe(a);
    useTabsStore.getState().focusPaneNext(-1);
    expect(paneTab(useTabsStore.getState().tabs, a)!.activePaneId).toBe(c);
    useTabsStore.getState().focusPaneNext(-1);
    expect(paneTab(useTabsStore.getState().tabs, a)!.activePaneId).toBe(b);
  });

  it("setActive accepts a pane id and activates its tab and pane", () => {
    const a = openHost("a");
    const b = useTabsStore.getState().splitPane(a, "right")!;
    openHost("other");

    useTabsStore.getState().setActive(a);
    let s = useTabsStore.getState();
    expect(s.activeId).toBe(tabIdOf(a));
    expect(paneTab(s.tabs, a)!.activePaneId).toBe(a);
    expect(s.lastPaneId).toBe(a);

    useTabsStore.getState().setActive(b);
    s = useTabsStore.getState();
    expect(paneTab(s.tabs, b)!.activePaneId).toBe(b);
    expect(s.lastPaneId).toBe(b);
  });
});

describe("openFile", () => {
  it("limits mounted file editors while still activating an existing file", () => {
    const store = useTabsStore.getState();
    for (let i = 0; i < MAX_FILE_TABS; i++) {
      store.openFile({
        connectionId: null,
        path: `/tmp/${i}`,
        name: String(i),
      });
    }

    store.openFile({
      connectionId: null,
      path: "/tmp/overflow",
      name: "overflow",
    });
    expect(useTabsStore.getState().tabs).toHaveLength(MAX_FILE_TABS);

    useTabsStore.getState().setActive(useTabsStore.getState().tabs[0]!.id);
    store.openFile({ connectionId: null, path: "/tmp/9", name: "9" });
    expect(useTabsStore.getState().activeId).toBe(
      useTabsStore.getState().tabs[9]!.id,
    );
  });
});

describe("close", () => {
  it("activates the right neighbor, falling back left", () => {
    const a = openHost("a");
    const b = openHost("b");
    const c = openHost("c");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(b);
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(c));
    useTabsStore.getState().close(c);
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(a));
  });

  it("keeps the active tab when closing an inactive one", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(a);
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(b));
  });

  it("repoints lastPaneId to the nearest surviving terminal pane", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(b);
    expect(useTabsStore.getState().lastPaneId).toBe(a);
  });

  it("disposes every pane when a split tab closes", () => {
    const a = openHost("a");
    const b = useTabsStore.getState().splitPane(a, "right")!;
    useTabsStore.getState().close(tabIdOf(a));
    expect(useTabsStore.getState().tabs).toHaveLength(0);
    expect(ipc.ssh.disconnect).toHaveBeenCalledWith(a, 0);
    expect(ipc.ssh.disconnect).toHaveBeenCalledWith(b, 0);
  });

  it("deflects a dirty file close into pendingCloseId", () => {
    const tab: FileTab = {
      kind: "file",
      id: "f1",
      connectionId: null,
      path: "/tmp/x",
      title: "x",
      content: "changed",
      savedContent: "orig",
      saving: false,
    };
    useTabsStore.setState({ tabs: [tab], activeId: "f1" });
    useTabsStore.getState().close("f1");
    const s = useTabsStore.getState();
    expect(s.pendingCloseId).toBe("f1");
    expect(s.tabs).toHaveLength(1);
    useTabsStore.getState().close("f1", { force: true });
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("blocks a window close while any file has unsaved content", () => {
    const tab: FileTab = {
      kind: "file",
      id: "dirty",
      connectionId: null,
      path: "/tmp/dirty",
      title: "dirty",
      content: "changed",
      savedContent: "original",
      saving: false,
    };
    useTabsStore.setState({ tabs: [tab] });

    expect(useTabsStore.getState().requestWindowClose()).toBe(true);
    expect(useTabsStore.getState().pendingWindowClose).toBe(true);

    useTabsStore.setState({
      tabs: [{ ...tab, savedContent: "changed" }],
    });
    expect(useTabsStore.getState().requestWindowClose()).toBe(false);
    expect(useTabsStore.getState().pendingWindowClose).toBe(false);
  });
});

describe("saveFile", () => {
  it("uses the loaded content as an optimistic concurrency guard", async () => {
    const tab: FileTab = {
      kind: "file",
      id: "file",
      connectionId: "remote",
      path: "/etc/app.conf",
      title: "app.conf",
      content: "new",
      savedContent: "old",
      saving: false,
    };
    useTabsStore.setState({ tabs: [tab] });

    await expect(useTabsStore.getState().saveFile(tab.id)).resolves.toBe(true);
    expect(ipc.sftp.writeText).toHaveBeenCalledWith(
      "remote",
      "/etc/app.conf",
      "new",
      "old",
    );
  });

  it("stays dirty when the buffer changes while a save is in flight", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(ipc.sftp.writeText).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const tab: FileTab = {
      kind: "file",
      id: "file",
      connectionId: null,
      path: "/tmp/file",
      title: "file",
      content: "first edit",
      savedContent: "old",
      saving: false,
    };
    useTabsStore.setState({ tabs: [tab] });

    const saving = useTabsStore.getState().saveFile(tab.id);
    useTabsStore.getState().updateFileContent(tab.id, "second edit");
    finish?.();

    await expect(saving).resolves.toBe(false);
    const current = useTabsStore.getState().tabs[0] as FileTab;
    expect(current.savedContent).toBe("first edit");
    expect(current.content).toBe("second edit");
    expect(isFileDirty(current)).toBe(true);
  });
});

describe("activateNext", () => {
  it("cycles forward and backward with wraparound", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().activateNext(1);
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(a));
    useTabsStore.getState().activateNext(-1);
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(b));
  });
});

describe("moveTab", () => {
  it("reorders tabs without changing the active tab", () => {
    const a = openHost("a");
    const b = openHost("b");
    const c = openHost("c");
    useTabsStore.getState().setActive(b);

    useTabsStore.getState().moveTab(tabIdOf(a), 2);

    const reorderedTabs = useTabsStore.getState().tabs;
    expect(reorderedTabs.map((tab) => tab.id)).toEqual([b, c, a].map(tabIdOf));
    expect(useTabsStore.getState().activeId).toBe(tabIdOf(b));
  });

  it("retains terminal tab objects and their connection status", () => {
    const store = useTabsStore.getState();
    const connected = openHost("connected");
    const connecting = openHost("connecting");
    store.setTerminalStatus(connected, "connected");
    const connectedTab = useTabsStore
      .getState()
      .tabs.find((tab) => tab.id === tabIdOf(connected));

    useTabsStore.getState().moveTab(tabIdOf(connected), 1);

    const reorderedTab = useTabsStore
      .getState()
      .tabs.find((tab) => tab.id === tabIdOf(connected));
    expect(reorderedTab).toBe(connectedTab);
    expect(terminalPanes([reorderedTab!]).map((pane) => pane.status)).toEqual([
      "connected",
    ]);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(
      [connecting, connected].map(tabIdOf),
    );
  });

  it("clamps the destination and ignores unknown tabs", () => {
    const a = openHost("a");
    const b = openHost("b");

    useTabsStore.getState().moveTab(tabIdOf(a), 100);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(
      [b, a].map(tabIdOf),
    );

    useTabsStore.getState().moveTab("missing", 0);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(
      [b, a].map(tabIdOf),
    );
  });
});

describe("selectors", () => {
  it("targetPaneId prefers the active tab's pane, else the last one", () => {
    const store = useTabsStore.getState();
    const a = openHost("a");
    store.openFile({ connectionId: null, path: "/tmp/a", name: "a" });
    expect(targetPaneId(useTabsStore.getState())).toBe(a);
    useTabsStore.getState().setActive(a);
    expect(targetPaneId(useTabsStore.getState())).toBe(a);
  });

  it("targetPaneId follows the focused pane inside a split", () => {
    const a = openHost("a");
    const b = useTabsStore.getState().splitPane(a, "right")!;
    expect(targetPaneId(useTabsStore.getState())).toBe(b);
    useTabsStore.getState().focusPane(a);
    expect(targetPaneId(useTabsStore.getState())).toBe(a);
  });

  it("terminalPanes flattens panes across terminal tabs only", () => {
    const store = useTabsStore.getState();
    const a = openHost("a");
    useTabsStore.getState().splitPane(a, "right");
    store.openFile({ connectionId: null, path: "/tmp/a", name: "a" });
    expect(terminalTabs(useTabsStore.getState().tabs)).toHaveLength(1);
    expect(terminalPanes(useTabsStore.getState().tabs)).toHaveLength(2);
  });

  it("isFileDirty compares buffer against saved content", () => {
    const base: FileTab = {
      kind: "file",
      id: "f",
      connectionId: null,
      path: "/p",
      title: "p",
      content: "x",
      savedContent: "x",
      saving: false,
    };
    expect(isFileDirty(base)).toBe(false);
    expect(isFileDirty({ ...base, content: "y" })).toBe(true);
    expect(isFileDirty({ ...base, content: null })).toBe(false);
  });
});

describe("sendToTerminal", () => {
  it("sends to the focused connected pane and records scoped history", () => {
    const id = openHost("a");
    const sendCommand = vi.fn();
    registerSession(id, { sendCommand } as unknown as TerminalSession);
    useTabsStore.getState().setTerminalStatus(id, "connected");

    expect(useTabsStore.getState().sendToTerminal("uptime")).toBe("sent");
    expect(sendCommand).toHaveBeenCalledWith("uptime");
    expect(ipc.history.add).toHaveBeenCalledWith("a", "uptime");

    unregisterSession(id);
  });
});
