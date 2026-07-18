import { describe, expect, it } from "vitest";

import {
  updateCargoLockVersion,
  updateCargoPackageVersion,
  updateJsonVersion,
} from "./sync-app-version.mjs";

describe("release version synchronization", () => {
  it("updates the Tauri application version structurally", () => {
    const input = `{
  "version": "2.3.0",
  "targets": ["app", "dmg"],
  "nested": {
    "version": "1.0"
  }
}
`;
    const updated = updateJsonVersion(
      input,
      "2.3.0",
      "2.4.0",
      "tauri.conf.json",
    );

    expect(updated).toBe(`{
  "version": "2.4.0",
  "targets": ["app", "dmg"],
  "nested": {
    "version": "1.0"
  }
}
`);
  });

  it("updates only the Cargo package version", () => {
    const input = `[package]
name = "sageport"
version = "2.3.0"

[dependencies]
russh-sftp = "2.3.0"
`;

    expect(updateCargoPackageVersion(input, "2.3.0", "2.4.0")).toBe(`[package]
name = "sageport"
version = "2.4.0"

[dependencies]
russh-sftp = "2.3.0"
`);
  });

  it("rejects an unexpected current version", () => {
    expect(() =>
      updateCargoPackageVersion(
        '[package]\nversion = "2.2.0"\n',
        "2.3.0",
        "2.4.0",
      ),
    ).toThrow("expected version 2.3.0, found 2.2.0");
  });

  it("updates only the Sageport package in Cargo.lock", () => {
    const input = `[[package]]
name = "russh-sftp"
version = "2.3.0"

[[package]]
name = "sageport"
version = "2.3.0"
dependencies = []
`;

    expect(updateCargoLockVersion(input, "2.3.0", "2.4.0")).toBe(`[[package]]
name = "russh-sftp"
version = "2.3.0"

[[package]]
name = "sageport"
version = "2.4.0"
dependencies = []
`);
  });
});
