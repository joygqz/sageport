import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { TASK_TEMPLATES } from "../src/features/tasks/templates.ts";

it.skipIf(process.platform === "win32")(
  "keeps an existing backup when pg_dump fails",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "sageport-backup-"));
    try {
      writeFileSync(join(directory, "pg_dump"), "#!/bin/sh\nexit 7\n", {
        mode: 0o700,
      });
      writeFileSync(join(directory, "mydb.dump"), "existing backup");
      const step = TASK_TEMPLATES.find(
        (template) => template.id === "databaseBackup",
      ).steps[0];
      if (step.type !== "remoteCommand")
        throw new Error("missing backup command");
      const command = step.command.replaceAll(
        "/tmp/mydb",
        join(directory, "mydb"),
      );
      const result = spawnSync("sh", ["-c", command], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      });
      expect(result.status).not.toBe(0);
      expect(readFileSync(join(directory, "mydb.dump"), "utf8")).toBe(
        "existing backup",
      );
      expect(readdirSync(directory).sort()).toEqual(["mydb.dump", "pg_dump"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
