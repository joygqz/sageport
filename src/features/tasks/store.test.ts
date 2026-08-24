import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    tasks: {
      run: vi.fn(() => Promise.resolve()),
      cancelRun: vi.fn(() => Promise.resolve()),
    },
    sftp: {
      onTransfer: vi.fn(() => Promise.resolve(() => {})),
    },
  },
}));

vi.stubGlobal("localStorage", { getItem: vi.fn(() => "en") });

import { ipc } from "@/lib/ipc";
import { useToastStore } from "@/lib/toast";
import type { Task, TaskRunEvent } from "@/types/models";
import { useTaskRunStore } from "./store";

function task(): Task {
  return {
    id: "t1",
    name: "Nightly backup",
    description: null,
    hostId: "h1",
    steps: JSON.stringify([
      { type: "remoteCommand", command: "uptime" },
      { type: "remoteCommand", command: "df -h" },
    ]),
    schedule: null,
    scheduleEnabled: false,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    revision: 1,
  };
}

const cancelled = Object.assign(new Error("cancelled"), { code: "cancelled" });

describe("task runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskRunStore.setState({ runs: {}, attachedId: null });
    useToastStore.setState({ toasts: [] });
  });

  it("continues a run and reports a transfer listener failure", async () => {
    const error = new Error("listener failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(ipc.sftp.onTransfer).mockRejectedValueOnce(error);

    await useTaskRunStore.getState().startRun(task(), "h1").completion;

    expect(ipc.tasks.run).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Failed to initialize task transfer progress:",
      error,
    );
    warn.mockRestore();
  });

  it("reports the finished run to callers that never attached", async () => {
    vi.mocked(ipc.tasks.run).mockImplementation(
      async (_id, _hostId, onEvent: (event: TaskRunEvent) => void) => {
        onEvent({ stepIndex: 0, status: "done", exitCode: 0 });
        onEvent({ stepIndex: 1, status: "done", exitCode: 0 });
      },
    );

    const run = await useTaskRunStore.getState().startRun(task(), "h1")
      .completion;

    expect(run?.status).toBe("done");
    expect(run?.taskName).toBe("Nightly backup");
    expect(useTaskRunStore.getState().runs).toEqual({});
  });

  it("stops showing steps as running once a run is cancelled", async () => {
    vi.mocked(ipc.tasks.run).mockImplementation(
      async (_id, _hostId, onEvent: (event: TaskRunEvent) => void) => {
        onEvent({ stepIndex: 0, status: "done", exitCode: 0 });
        onEvent({ stepIndex: 1, status: "start" });
        throw cancelled;
      },
    );

    const started = useTaskRunStore.getState().startRun(task(), "h1");
    useTaskRunStore.getState().attach(started.requestId);
    await started.completion;

    const run = useTaskRunStore.getState().runs[started.requestId];
    expect(run.status).toBe("cancelled");
    expect(run.stepStates.map((step) => step.status)).toEqual([
      "done",
      "skipped",
    ]);
  });

  it("keeps the failure message and marks unreached steps as skipped", async () => {
    vi.mocked(ipc.tasks.run).mockImplementation(
      async (_id, _hostId, onEvent: (event: TaskRunEvent) => void) => {
        onEvent({ stepIndex: 0, status: "error", exitCode: 1 });
        throw new Error("host is unreachable");
      },
    );

    const started = useTaskRunStore.getState().startRun(task(), "h1");
    useTaskRunStore.getState().attach(started.requestId);
    await started.completion;

    const run = useTaskRunStore.getState().runs[started.requestId];
    expect(run.status).toBe("error");
    expect(run.error).toBe("host is unreachable");
    expect(run.stepStates.map((step) => step.status)).toEqual([
      "error",
      "skipped",
    ]);
  });
});
