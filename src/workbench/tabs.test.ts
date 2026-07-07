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

import {
  SETTINGS_TAB_ID,
  isFileDirty,
  targetTerminalId,
  terminalTabs,
  useTabsStore,
} from "./tabs";
import type { FileTab } from "./tabs";

const host = (id: string) => ({ id, label: `host-${id}` });

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
    const id = useTabsStore.getState().openTerminal(host("a"));
    const s = useTabsStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(id);
    expect(s.lastTerminalId).toBe(id);
  });
});

describe("close", () => {
  it("activates the right neighbor, falling back left", () => {
    const store = useTabsStore.getState();
    const a = store.openTerminal(host("a"));
    const b = store.openTerminal(host("b"));
    const c = store.openTerminal(host("c"));
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(b);
    expect(useTabsStore.getState().activeId).toBe(c);
    useTabsStore.getState().close(c);
    expect(useTabsStore.getState().activeId).toBe(a);
  });

  it("keeps the active tab when closing an inactive one", () => {
    const store = useTabsStore.getState();
    const a = store.openTerminal(host("a"));
    const b = store.openTerminal(host("b"));
    useTabsStore.getState().setActive(b);
    useTabsStore.getState().close(a);
    expect(useTabsStore.getState().activeId).toBe(b);
  });

  it("repoints lastTerminalId to the nearest surviving terminal", () => {
    const store = useTabsStore.getState();
    const a = store.openTerminal(host("a"));
    const b = store.openTerminal(host("b"));
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
    const store = useTabsStore.getState();
    const a = store.openTerminal(host("a"));
    const b = store.openTerminal(host("b"));
    useTabsStore.getState().activateNext(1);
    expect(useTabsStore.getState().activeId).toBe(a);
    useTabsStore.getState().activateNext(-1);
    expect(useTabsStore.getState().activeId).toBe(b);
  });
});

describe("openSettings", () => {
  it("creates one settings tab and refocuses it with a new section", () => {
    useTabsStore.getState().openSettings();
    useTabsStore.getState().openTerminal(host("a"));
    useTabsStore.getState().openSettings("sync");
    const s = useTabsStore.getState();
    expect(s.tabs.filter((t) => t.kind === "settings")).toHaveLength(1);
    expect(s.activeId).toBe(SETTINGS_TAB_ID);
    const settings = s.tabs.find((t) => t.kind === "settings");
    expect(settings?.kind === "settings" && settings.section).toBe("sync");
  });
});

describe("selectors", () => {
  it("targetTerminalId prefers the active terminal, else the last one", () => {
    const store = useTabsStore.getState();
    const a = store.openTerminal(host("a"));
    useTabsStore.getState().openSettings();
    expect(targetTerminalId(useTabsStore.getState())).toBe(a);
    useTabsStore.getState().setActive(a);
    expect(targetTerminalId(useTabsStore.getState())).toBe(a);
  });

  it("terminalTabs filters non-terminal tabs", () => {
    const store = useTabsStore.getState();
    store.openTerminal(host("a"));
    useTabsStore.getState().openSettings();
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
