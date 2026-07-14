import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ssh: {
      disconnect: vi.fn(() => Promise.resolve()),
      send: vi.fn(() => Promise.resolve()),
    },
    sftp: {
      readText: vi.fn(() => new Promise(() => {})),
      writeText: vi.fn(() => Promise.resolve()),
    },
  },
}));

vi.stubGlobal("localStorage", { getItem: vi.fn(() => "en") });

import {
  isFileDirty,
  MAX_TERMINAL_TABS,
  targetTerminalId,
  terminalTabs,
  useTabsStore,
} from "./tabs";
import type { FileTab } from "./tabs";

const host = (id: string) => ({ id, label: `host-${id}` });

function openHost(id: string): string {
  const tabId = useTabsStore.getState().openTerminal(host(id));
  if (!tabId) throw new Error("Expected terminal tab to open");
  return tabId;
}

beforeEach(() => {
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastTerminalId: null,
    pendingCloseId: null,
  });
});

describe("openTerminal", () => {
  it("appends the tab, activates it, and tracks it as last terminal", () => {
    const id = openHost("a");
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id);
    expect(s.lastTerminalId).toBe(id);
  });

  it("rejects new terminal tabs after reaching the limit", () => {
    const store = useTabsStore.getState();
    for (let i = 0; i < MAX_TERMINAL_TABS; i++) {
      expect(store.openTerminal(host(String(i)))).not.toBeNull();
    }

    expect(store.openLocalTerminal()).toBeNull();
    expect(useTabsStore.getState().tabs).toHaveLength(MAX_TERMINAL_TABS);
  });

  it("allows another terminal after one is closed", () => {
    const store = useTabsStore.getState();
    const ids = Array.from({ length: MAX_TERMINAL_TABS }, (_, i) =>
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
    expect(useTabsStore.getState().tabs).toHaveLength(MAX_TERMINAL_TABS);
  });
});

describe("close", () => {
  it("activates the right neighbor, falling back left", () => {
    const a = openHost("a");
    const b = openHost("b");
    const c = openHost("c");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(b);
    expect(useTabsStore.getState().activeId).toBe(c);
    useTabsStore.getState().close(c);
    expect(useTabsStore.getState().activeId).toBe(a);
  });

  it("keeps the active tab when closing an inactive one", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(a);
    expect(useTabsStore.getState().activeId).toBe(b);
  });

  it("repoints lastTerminalId to the nearest surviving terminal", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(b);
    expect(useTabsStore.getState().lastTerminalId).toBe(a);
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
});

describe("activateNext", () => {
  it("cycles forward and backward with wraparound", () => {
    const a = openHost("a");
    const b = openHost("b");
    useTabsStore.getState().activateNext(1);
    expect(useTabsStore.getState().activeId).toBe(a);
    useTabsStore.getState().activateNext(-1);
    expect(useTabsStore.getState().activeId).toBe(b);
  });
});

describe("moveTab", () => {
  it("reorders tabs without changing the active tab", () => {
    const a = openHost("a");
    const b = openHost("b");
    const c = openHost("c");
    useTabsStore.getState().setActive(b);

    useTabsStore.getState().moveTab(a, 2);

    const reorderedTabs = useTabsStore.getState().tabs;
    expect(reorderedTabs.map((tab) => tab.id)).toEqual([b, c, a]);
    expect(useTabsStore.getState().activeId).toBe(b);
  });

  it("retains terminal tab objects and their connection status", () => {
    const store = useTabsStore.getState();
    const connected = openHost("connected");
    const connecting = openHost("connecting");
    store.setTerminalStatus(connected, "connected");
    const connectedTab = useTabsStore
      .getState()
      .tabs.find((tab) => tab.id === connected);

    useTabsStore.getState().moveTab(connected, 1);

    const reorderedTab = useTabsStore
      .getState()
      .tabs.find((tab) => tab.id === connected);
    expect(reorderedTab).toBe(connectedTab);
    expect(reorderedTab).toMatchObject({ status: "connected" });
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([
      connecting,
      connected,
    ]);
  });

  it("clamps the destination and ignores unknown tabs", () => {
    const a = openHost("a");
    const b = openHost("b");

    useTabsStore.getState().moveTab(a, 100);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([b, a]);

    useTabsStore.getState().moveTab("missing", 0);
    expect(useTabsStore.getState().tabs.map((tab) => tab.id)).toEqual([b, a]);
  });
});

describe("selectors", () => {
  it("targetTerminalId prefers the active terminal, else the last one", () => {
    const store = useTabsStore.getState();
    const a = openHost("a");
    store.openFile({ connectionId: null, path: "/tmp/a", name: "a" });
    expect(targetTerminalId(useTabsStore.getState())).toBe(a);
    useTabsStore.getState().setActive(a);
    expect(targetTerminalId(useTabsStore.getState())).toBe(a);
  });

  it("terminalTabs filters non-terminal tabs", () => {
    const store = useTabsStore.getState();
    store.openTerminal(host("a"));
    store.openFile({ connectionId: null, path: "/tmp/a", name: "a" });
    expect(terminalTabs(useTabsStore.getState().tabs)).toHaveLength(1);
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
