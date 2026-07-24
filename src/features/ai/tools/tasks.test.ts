import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    tasks: {
      create: mocks.create,
      update: mocks.update,
      list: mocks.list,
    },
  },
}));

vi.mock("./cache", () => ({ invalidateTasks: vi.fn() }));

import type { Task, TaskInput } from "@/types/models";
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
