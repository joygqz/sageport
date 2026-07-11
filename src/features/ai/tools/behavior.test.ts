import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  snippetsList,
  snippetsCreate,
  forwardsList,
  forwardsActive,
  hostsRun,
  hostsList,
  groupsCreate,
  keysList,
} = vi.hoisted(() => ({
  snippetsList: vi.fn(),
  snippetsCreate: vi.fn(),
  forwardsList: vi.fn(),
  forwardsActive: vi.fn(),
  hostsRun: vi.fn(),
  hostsList: vi.fn(),
  groupsCreate: vi.fn(),
  keysList: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    snippets: { list: snippetsList, create: snippetsCreate },
    forwards: { list: forwardsList, active: forwardsActive },
    hosts: { runCommand: hostsRun, list: hostsList },
    groups: { create: groupsCreate },
    keys: { list: keysList },
  },
}));

import { queryClient } from "@/lib/query";
import type { TerminalTab } from "@/workbench/tabs";
import { useTabsStore } from "@/workbench/tabs";
import { getTool } from "./registry";

function terminal(id: string): TerminalTab {
  return {
    kind: "terminal",
    id,
    target: "ssh",
    hostId: `host-${id}`,
    title: id,
    status: "connected",
    attempt: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabsStore.setState({
    tabs: [],
    activeId: null,
    lastTerminalId: null,
    pendingCloseId: null,
  });
});

describe("run_snippet prepare", () => {
  beforeEach(() => {
    const current = terminal("t1");
    useTabsStore.setState({
      tabs: [current],
      activeId: current.id,
      lastTerminalId: current.id,
    });
  });

  it("substitutes variables and targets the current terminal", async () => {
    snippetsList.mockResolvedValue([
      { id: "s1", name: "greet", command: "echo {{name}}", description: null },
    ]);
    const prepared = await getTool("run_snippet")!.prepare!(
      { snippetId: "s1", values: { name: "world" } },
      { userPrompt: "" },
    );
    expect(prepared.args.command).toBe("echo world");
    expect(prepared.args.sessionId).toBe("t1");
    expect(prepared.preflightError).toBeUndefined();
  });

  it("reports a preflight error for an unknown snippet", async () => {
    snippetsList.mockResolvedValue([]);
    const prepared = await getTool("run_snippet")!.prepare!(
      { snippetId: "missing" },
      { userPrompt: "" },
    );
    expect(prepared.preflightError).toContain("no snippet");
  });

  it("rejects a snippet that resolves to an empty command", async () => {
    snippetsList.mockResolvedValue([
      { id: "s2", name: "blank", command: "{{x}}", description: null },
    ]);
    const prepared = await getTool("run_snippet")!.prepare!(
      { snippetId: "s2" },
      { userPrompt: "" },
    );
    expect(prepared.preflightError).toContain("empty command");
  });
});

describe("SFTP target preparation", () => {
  it("pins the current host before an approval wait", async () => {
    const current = terminal("t1");
    useTabsStore.setState({
      tabs: [current],
      activeId: current.id,
      lastTerminalId: current.id,
    });

    const prepared = await getTool("write_file")!.prepare!(
      { path: "/etc/app.conf", content: "enabled=true" },
      { userPrompt: "update the config" },
    );

    expect(prepared.args).toMatchObject({
      hostId: "host-t1",
      path: "/etc/app.conf",
    });
  });
});

describe("list_forwards", () => {
  it("merges the active set into each forward", async () => {
    forwardsList.mockResolvedValue([
      {
        id: "f1",
        label: "web",
        hostId: "h",
        kind: "local",
        bindHost: "127.0.0.1",
        bindPort: 8080,
        targetHost: "10.0.0.1",
        targetPort: 80,
      },
      {
        id: "f2",
        label: "socks",
        hostId: "h",
        kind: "dynamic",
        bindHost: "127.0.0.1",
        bindPort: 1080,
        targetHost: null,
        targetPort: null,
      },
    ]);
    forwardsActive.mockResolvedValue(["f1"]);

    const result = await getTool("list_forwards")!.execute!({}, {});
    const parsed = JSON.parse(result.content);
    expect(parsed[0]).toMatchObject({
      id: "f1",
      active: true,
      target: "10.0.0.1:80",
    });
    expect(parsed[1]).toMatchObject({ id: "f2", active: false });
    expect(parsed[1].target).toBeUndefined();
  });
});

describe("cache invalidation", () => {
  it("refreshes the snippets query after saving a snippet", async () => {
    snippetsCreate.mockResolvedValue({ id: "s9", name: "deploy" });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await getTool("save_snippet")!.execute!(
      { name: "deploy", command: "make deploy" },
      {},
    );

    expect(spy).toHaveBeenCalledWith({ queryKey: ["snippets"] });
    spy.mockRestore();
  });

  it("refreshes the groups query after creating a group", async () => {
    groupsCreate.mockResolvedValue({ id: "g1", name: "prod" });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await getTool("create_group")!.execute!({ name: "prod" }, {});

    expect(spy).toHaveBeenCalledWith({ queryKey: ["groups"] });
    spy.mockRestore();
  });
});

describe("list_ssh_keys", () => {
  it("never returns private key material", async () => {
    keysList.mockResolvedValue([
      {
        id: "k1",
        name: "prod",
        publicKey: "ssh-ed25519 AAAA...",
        privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----secret",
        passphrase: "hunter2",
      },
    ]);

    const result = await getTool("list_ssh_keys")!.execute!({}, {});
    expect(result.content).not.toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(result.content).not.toContain("hunter2");
    const parsed = JSON.parse(result.content);
    expect(parsed[0]).toMatchObject({ name: "prod", hasPrivateKey: true });
    expect(parsed[0].privateKey).toBeUndefined();
  });
});

describe("run_command_on_hosts", () => {
  it("aggregates streamed results per host with labels and exit codes", async () => {
    hostsRun.mockImplementation(
      (
        _ids: string[],
        _command: string,
        onEvent: (e: {
          hostId: string;
          status: string;
          output?: string;
          exitCode?: number;
          message?: string;
        }) => void,
      ) => {
        onEvent({ hostId: "h1", status: "done", output: "ok", exitCode: 0 });
        onEvent({ hostId: "h2", status: "error", message: "boom" });
        return Promise.resolve();
      },
    );
    hostsList.mockResolvedValue([
      { id: "h1", label: "Alpha" },
      { id: "h2", label: "Beta" },
    ]);

    const result = await getTool("run_command_on_hosts")!.execute!(
      { hostIds: ["h1", "h2"], command: "uptime" },
      {},
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("## Alpha (exit 0)");
    expect(result.content).toContain("ok");
    expect(result.content).toContain("## Beta — error");
    expect(result.content).toContain("boom");
  });
});
