import { describe, expect, it } from "vitest";

import type { Task } from "@/types/models";
import { parseTaskSteps, parseTaskRunSteps } from "./api";

const parse = (steps: unknown) =>
  parseTaskSteps({ steps: JSON.stringify(steps) } as Task);

describe("task step data", () => {
  it("rejects malformed stored steps before rendering", () => {
    for (const steps of [
      null,
      {},
      [null],
      [{ type: "unknown" }],
      [{ type: "localCommand", command: 1 }],
      [{ type: "upload", localPath: "a" }],
      [{ type: "localCommand", command: "echo", retries: -1 }],
    ]) {
      expect(parse(steps)).toEqual([]);
    }
  });

  it("accepts valid commands and transfer steps", () => {
    const steps = [
      { type: "localCommand", command: "echo hi", cwd: null },
      {
        type: "download",
        localPath: "~/backup",
        remotePath: "/tmp/backup",
        retries: 2,
      },
    ];
    expect(parse(steps)).toEqual(steps);
  });
});

it("rejects malformed history records before rendering or summarizing", () => {
  for (const record of [
    null,
    { step: { type: "unknown" }, status: "done" },
    {
      step: { type: "localCommand", command: "true" },
      status: "done",
      log: {},
    },
  ]) {
    expect(parseTaskRunSteps(JSON.stringify([record]))).toEqual([]);
  }
});
