import { execFileSync } from "node:child_process";
import { defineConfig } from "bumpp";
import { syncAppVersion } from "./scripts/sync-app-version.mjs";

export default defineConfig({
  files: ["package.json"],
  execute: (operation) => {
    const { cwd } = operation.options;
    const { currentVersion, newVersion } = operation.state;
    const updatedFiles = syncAppVersion({
      root: cwd,
      currentVersion,
      newVersion,
    });
    execFileSync(
      "cargo",
      [
        "check",
        "--quiet",
        "--locked",
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
      { cwd, stdio: "inherit" },
    );

    operation.update({
      updatedFiles: [...operation.state.updatedFiles, ...updatedFiles],
    });
  },
  all: false,
  noGitCheck: false,
  tag: true,
});
