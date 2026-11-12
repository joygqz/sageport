import { describe, expect, it } from "vitest";

import type { Task, TaskStep } from "@/types/models";
import { dueTasks, type ScheduleState } from "./scheduler";

function task(
  overrides: Omit<Partial<Task>, "steps"> & { steps?: TaskStep[] },
): Task {
  const { steps = [{ type: "localCommand", command: "echo hi" }], ...rest } =
    overrides;
  return {
    id: "t1",
    name: "Task",
    description: null,
    hostId: null,
    steps: JSON.stringify(steps),
    schedule: "* * * * *",
    scheduleEnabled: true,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    revision: 1,
    ...rest,
  };
}

const never = () => false;
const signature = (cron: string, revision = 1) =>
  `${cron}|${revision}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

describe("dueTasks", () => {
  it("baselines a newly seen schedule without firing", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const result = dueTasks(now, [task({})], {}, never);
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1).toEqual({
      lastRun: now.toISOString(),
      sig: signature("* * * * *"),
    });
  });

  it("re-baselines when the cron expression changes", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const prev: ScheduleState = {
      t1: {
        lastRun: new Date(2026, 0, 1, 11, 0, 0).toISOString(),
        sig: signature("0 3 * * *"),
      },
    };
    const result = dueTasks(
      now,
      [task({ schedule: "* * * * *" })],
      prev,
      never,
    );
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1.lastRun).toBe(now.toISOString());
  });

  it.each(["invalid", new Date(2026, 0, 2).toISOString()])(
    "recovers from an invalid or future baseline: %s",
    (lastRun) => {
      const now = new Date(2026, 0, 1, 12, 0, 0);
      const result = dueTasks(
        now,
        [task({})],
        { t1: { lastRun, sig: signature("* * * * *") } },
        never,
      );
      expect(result.fire).toHaveLength(0);
      expect(result.state.t1.lastRun).toBe(now.toISOString());
      const next = dueTasks(
        new Date(now.getTime() + 60_000),
        [task({})],
        result.state,
        never,
      );
      expect(next.fire.map((item) => item.id)).toEqual(["t1"]);
    },
  );

  it("skips runs missed by more than one minute", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const prev: ScheduleState = {
      t1: {
        lastRun: new Date(2026, 0, 1, 11, 0, 0).toISOString(),
        sig: signature("* * * * *"),
      },
    };
    const result = dueTasks(now, [task({})], prev, never);
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1.lastRun).toBe(now.toISOString());
  });

  it("keeps the baseline when not yet due", () => {
    const now = new Date(2026, 0, 1, 12, 0, 30);
    const prev: ScheduleState = {
      t1: {
        lastRun: new Date(2026, 0, 1, 12, 0, 0).toISOString(),
        sig: signature("0 3 * * *"),
      },
    };
    const result = dueTasks(
      now,
      [task({ schedule: "0 3 * * *" })],
      prev,
      never,
    );
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1).toEqual(prev.t1);
  });

  it("skips a due task that is already running", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const prev: ScheduleState = {
      t1: {
        lastRun: new Date(2026, 0, 1, 11, 0, 0).toISOString(),
        sig: signature("* * * * *"),
      },
    };
    const result = dueTasks(now, [task({})], prev, () => true);
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1.lastRun).toEqual(now.toISOString());
  });

  it("skips remote tasks with no fixed host and reports the reason", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const prev: ScheduleState = {
      t1: {
        lastRun: new Date(2026, 0, 1, 11, 59, 0).toISOString(),
        sig: signature("* * * * *"),
      },
    };
    const remote = task({
      steps: [{ type: "remoteCommand", command: "uptime" }],
      hostId: null,
    });
    const result = dueTasks(now, [remote], prev, never);
    expect(result.fire).toHaveLength(0);
    expect(result.skipped).toEqual([{ task: remote, reason: "noHost" }]);
    expect(result.state.t1.lastRun).toBe(now.toISOString());
  });

  it("prunes disabled or invalid schedules from the state", () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const prev: ScheduleState = {
      t1: { lastRun: now.toISOString(), sig: signature("* * * * *") },
    };
    const disabled = dueTasks(
      now,
      [task({ scheduleEnabled: false })],
      prev,
      never,
    );
    expect(disabled.state.t1).toBeUndefined();
    const invalid = dueTasks(now, [task({ schedule: "nope" })], prev, never);
    expect(invalid.state.t1).toBeUndefined();
  });
});

describe("schedule execution boundaries", () => {
  it("fires a due schedule within the grace period", () => {
    const now = new Date(2026, 0, 1, 12, 0, 30);
    const result = dueTasks(
      now,
      [task({})],
      {
        t1: {
          lastRun: new Date(2026, 0, 1, 11, 59).toISOString(),
          sig: signature("* * * * *"),
        },
      },
      never,
    );
    expect(result.fire).toHaveLength(1);
    expect(dueTasks(now, [task({})], result.state, never).fire).toHaveLength(0);
  });

  it("does not immediately run a changed task using an old schedule baseline", () => {
    const now = new Date(2026, 0, 1, 12, 0);
    const result = dueTasks(
      now,
      [task({ revision: 2 })],
      {
        t1: {
          lastRun: new Date(2026, 0, 1, 11, 59).toISOString(),
          sig: signature("* * * * *"),
        },
      },
      never,
    );
    expect(result.fire).toHaveLength(0);
    expect(result.state.t1.sig).toBe(signature("* * * * *", 2));
  });
});
