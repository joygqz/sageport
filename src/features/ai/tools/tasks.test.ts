import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  runsList: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    tasks: {
      create: mocks.create,
      update: mocks.update,
      list: mocks.list,
      runsList: mocks.runsList,
    },
  },
}));

vi.mock("./cache", () => ({ invalidateTasks: vi.fn() }));

import type { Task, TaskInput, TaskRunHistoryEntry } from "@/types/models";
import { taskTools } from "./tasks";

function tool(name: string) {
  const found = taskTools.find((t) => t.spec.name === name);
  if (!found?.execute) throw new Error(`missing tool ${name}`);
  return found.execute;
}

function task(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    name: "Backup",
    description: null,
    hostId: null,
    steps: JSON.stringify([{ type: "localCommand", command: "echo hi" }]),
    schedule: null,
    scheduleEnabled: false,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    revision: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("save_task", () => {
  it("passes schedule and scheduleEnabled through to create", async () => {
    mocks.create.mockResolvedValue(task({ name: "Backup" }));
    await tool("save_task")(
      {
        name: "Backup",
        steps: [{ type: "localCommand", command: "echo hi" }],
        schedule: "0 3 * * *",
        scheduleEnabled: true,
      },
      {},
    );
    const input = mocks.create.mock.calls[0][0] as TaskInput;
    expect(input.schedule).toBe("0 3 * * *");
    expect(input.scheduleEnabled).toBe(true);
  });
});

describe("update_task", () => {
  it("keeps the existing schedule when not provided", async () => {
    mocks.list.mockResolvedValue([
      task({ schedule: "0 3 * * *", scheduleEnabled: true }),
    ]);
    mocks.update.mockResolvedValue(task({}));
    await tool("update_task")({ id: "t1", name: "Renamed" }, {});
    const input = mocks.update.mock.calls[0][1] as TaskInput;
    expect(input.schedule).toBe("0 3 * * *");
    expect(input.scheduleEnabled).toBe(true);
  });

  it("clears the schedule when passed null", async () => {
    mocks.list.mockResolvedValue([
      task({ schedule: "0 3 * * *", scheduleEnabled: true }),
    ]);
    mocks.update.mockResolvedValue(task({}));
    await tool("update_task")(
      { id: "t1", schedule: null, scheduleEnabled: false },
      {},
    );
    const input = mocks.update.mock.calls[0][1] as TaskInput;
    expect(input.schedule).toBeNull();
    expect(input.scheduleEnabled).toBe(false);
  });
});

describe("list_tasks", () => {
  it("reports schedule and a computed next run", async () => {
    mocks.list.mockResolvedValue([
      task({ schedule: "0 3 * * *", scheduleEnabled: true }),
    ]);
    const result = await tool("list_tasks")({}, {});
    const parsed = JSON.parse(result.content) as Array<{
      schedule?: string;
      scheduleEnabled?: boolean;
      nextRun?: string;
    }>;
    expect(parsed[0].schedule).toBe("0 3 * * *");
    expect(parsed[0].scheduleEnabled).toBe(true);
    expect(typeof parsed[0].nextRun).toBe("string");
  });
});

function runEntry(
  overrides: Partial<TaskRunHistoryEntry>,
): TaskRunHistoryEntry {
  return {
    id: "r1",
    taskId: "t1",
    taskName: "Backup",
    hostId: null,
    hostLabel: null,
    steps: JSON.stringify([
      { step: { type: "localCommand", command: "echo hi" }, status: "done" },
    ]),
    totalSteps: 1,
    status: "done",
    message: null,
    startedAt: "2026-07-24T03:00:00.000Z",
    finishedAt: "2026-07-24T03:00:01.000Z",
    ...overrides,
  };
}

describe("list_task_runs", () => {
  it("summarizes runs with per-step outcomes", async () => {
    mocks.runsList.mockResolvedValue([runEntry({})]);
    const result = await tool("list_task_runs")({}, {});
    const parsed = JSON.parse(result.content) as Array<{
      id: string;
      status: string;
      steps: string[];
    }>;
    expect(parsed[0].id).toBe("r1");
    expect(parsed[0].status).toBe("done");
    expect(parsed[0].steps[0]).toContain("done");
  });

  it("filters by taskId and respects the limit", async () => {
    mocks.runsList.mockResolvedValue([
      runEntry({ id: "r1", taskId: "t1" }),
      runEntry({ id: "r2", taskId: "t2" }),
      runEntry({ id: "r3", taskId: "t1" }),
    ]);
    const result = await tool("list_task_runs")({ taskId: "t1", limit: 1 }, {});
    const parsed = JSON.parse(result.content) as Array<{ id: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("r1");
  });

  it("reports when a task has no runs", async () => {
    mocks.runsList.mockResolvedValue([runEntry({ taskId: "other" })]);
    const result = await tool("list_task_runs")({ taskId: "t1" }, {});
    expect(result.content).toContain("No runs recorded");
  });
});
