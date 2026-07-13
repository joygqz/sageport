import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelTransfer: vi.fn(),
  hostsGet: vi.fn(),
  onTransfer: vi.fn(),
  transfer: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    hosts: { get: mocks.hostsGet },
    sftp: {
      cancelTransfer: mocks.cancelTransfer,
      connect: vi.fn(),
      onStatus: vi.fn(() => Promise.resolve(() => {})),
      onTransfer: mocks.onTransfer,
      transfer: mocks.transfer,
    },
  },
}));

import { useSftpStore, type SftpTab } from "@/features/sftp/store";
import type { TransferEvent } from "@/types/models";
import { fileTools } from "./files";

const transferTool = fileTools.find(
  (tool) => tool.spec.name === "transfer_file",
)!;

function remoteTab(
  id: string,
  hostId: string,
  connectionId: string,
  cwd = "/",
): SftpTab {
  return {
    id,
    kind: "remote",
    connectionId,
    hostId,
    title: hostId,
    cwd,
    status: "connected",
    entries: [],
    selected: [],
    loading: false,
  };
}

function terminalEvent(
  transferId: string,
  status: TransferEvent["status"] = "done",
  message?: string,
): TransferEvent {
  return {
    transferId,
    transferred: 10,
    total: 10,
    file: "file.txt",
    status,
    message,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSftpStore.setState((state) => ({
    ...state,
    panes: {
      left: { tabs: [], activeTabId: null },
      right: { tabs: [], activeTabId: null },
    },
  }));

  let handler: ((event: TransferEvent) => void) | undefined;
  mocks.onTransfer.mockImplementation(async (candidate) => {
    handler = candidate;
    return mocks.unlisten;
  });
  mocks.transfer.mockImplementation(async (transferId) => {
    handler?.(terminalEvent(transferId));
  });
});

describe("transfer_file", () => {
  it("uploads a local path to an SFTP destination and waits for completion", async () => {
    useSftpStore.setState((state) => ({
      ...state,
      panes: {
        ...state.panes,
        right: {
          tabs: [remoteTab("tab", "host-1", "conn-1", "/uploads")],
          activeTabId: "tab",
        },
      },
    }));

    const result = await transferTool.execute!(
      {
        source: { kind: "local", path: "/tmp/file.txt" },
        destination: {
          kind: "sftp",
          hostId: "host-1",
          path: "/uploads",
        },
      },
      {},
    );

    expect(result).toEqual({
      content: expect.stringContaining("Transferred local:/tmp/file.txt"),
      isError: false,
    });
    expect(mocks.transfer).toHaveBeenCalledWith(
      expect.any(String),
      { connectionId: null, path: "/tmp/file.txt" },
      { connectionId: "conn-1", path: "/uploads" },
    );
    expect(mocks.onTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transfer.mock.invocationCallOrder[0],
    );
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("supports SFTP-to-SFTP transfers with distinct connections", async () => {
    useSftpStore.setState((state) => ({
      ...state,
      panes: {
        left: {
          tabs: [remoteTab("source", "host-a", "conn-a")],
          activeTabId: "source",
        },
        right: {
          tabs: [remoteTab("destination", "host-b", "conn-b")],
          activeTabId: "destination",
        },
      },
    }));

    const result = await transferTool.execute!(
      {
        source: { kind: "sftp", hostId: "host-a", path: "/src/app" },
        destination: {
          kind: "sftp",
          hostId: "host-b",
          path: "/backup",
        },
      },
      {},
    );

    expect(result.isError).toBe(false);
    expect(mocks.transfer).toHaveBeenCalledWith(
      expect.any(String),
      { connectionId: "conn-a", path: "/src/app" },
      { connectionId: "conn-b", path: "/backup" },
    );
  });

  it("rejects ambiguous or unsupported endpoints before invoking IPC", async () => {
    await expect(
      transferTool.execute!(
        {
          source: { kind: "local", path: "relative.txt" },
          destination: {
            kind: "sftp",
            hostId: "host-1",
            path: "/uploads",
          },
        },
        {},
      ),
    ).resolves.toEqual({
      content: "Error: source.path must be an absolute local path.",
      isError: true,
    });

    await expect(
      transferTool.execute!(
        {
          source: { kind: "local", path: "/tmp/a" },
          destination: { kind: "local", path: "/tmp/b" },
        },
        {},
      ),
    ).resolves.toEqual({
      content: expect.stringContaining("at least one SFTP endpoint"),
      isError: true,
    });
    expect(mocks.transfer).not.toHaveBeenCalled();
  });

  it("returns terminal transfer failures and always removes its listener", async () => {
    useSftpStore.setState((state) => ({
      ...state,
      panes: {
        ...state.panes,
        left: {
          tabs: [remoteTab("tab", "host-1", "conn-1")],
          activeTabId: "tab",
        },
      },
    }));
    mocks.transfer.mockImplementationOnce(async (transferId) => {
      const handler = mocks.onTransfer.mock.calls[0]?.[0];
      handler?.(terminalEvent(transferId, "error", "permission denied"));
    });

    const result = await transferTool.execute!(
      {
        source: { kind: "sftp", hostId: "host-1", path: "/secret" },
        destination: { kind: "local", path: "/tmp" },
      },
      {},
    );

    expect(result).toEqual({
      content: expect.stringContaining("permission denied"),
      isError: true,
    });
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("cleans up its listener when the backend cannot start the transfer", async () => {
    useSftpStore.setState((state) => ({
      ...state,
      panes: {
        ...state.panes,
        left: {
          tabs: [remoteTab("tab", "host-1", "conn-1")],
          activeTabId: "tab",
        },
      },
    }));
    mocks.transfer.mockRejectedValueOnce(new Error("could not enqueue"));

    const result = await transferTool.execute!(
      {
        source: { kind: "sftp", hostId: "host-1", path: "/file" },
        destination: { kind: "local", path: "/tmp" },
      },
      {},
    );

    expect(result).toEqual({
      content: "Error: could not enqueue",
      isError: true,
    });
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("cancels the backend transfer when the assistant run is stopped", async () => {
    vi.useFakeTimers();
    try {
      useSftpStore.setState((state) => ({
        ...state,
        panes: {
          ...state.panes,
          left: {
            tabs: [remoteTab("tab", "host-1", "conn-1")],
            activeTabId: "tab",
          },
        },
      }));
      mocks.transfer.mockResolvedValueOnce(undefined);
      let stopped = false;
      mocks.cancelTransfer.mockImplementationOnce(async (transferId) => {
        const handler = mocks.onTransfer.mock.calls[0]?.[0];
        handler?.(terminalEvent(transferId, "cancelled"));
      });

      const pending = transferTool.execute!(
        {
          source: { kind: "sftp", hostId: "host-1", path: "/large-dir" },
          destination: { kind: "local", path: "/tmp" },
        },
        { isCancelled: () => stopped },
      );
      await vi.advanceTimersByTimeAsync(1);
      stopped = true;
      await vi.advanceTimersByTimeAsync(250);

      await expect(pending).resolves.toEqual({
        content: expect.stringContaining("was cancelled"),
        isError: true,
      });
      expect(mocks.cancelTransfer).toHaveBeenCalledOnce();
      expect(mocks.unlisten).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
