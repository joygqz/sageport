import { describe, expect, it } from "vitest";

import {
  inlineCreateBlurAction,
  inlineCreateRowIndex,
} from "./file-list-layout";

describe("inlineCreateBlurAction", () => {
  it("creates for a non-empty name and cancels for blank input", () => {
    expect(inlineCreateBlurAction("report.txt")).toBe("create");
    expect(inlineCreateBlurAction("  ")).toBe("cancel");
    expect(inlineCreateBlurAction("")).toBe("cancel");
  });
});

describe("inlineCreateRowIndex", () => {
  it("places a new file input after the last directory", () => {
    expect(
      inlineCreateRowIndex(
        [{ kind: "dir" }, { kind: "dir" }, { kind: "file" }],
        "file",
      ),
    ).toBe(2);
  });

  it("places a new file input first when there are no directories", () => {
    expect(
      inlineCreateRowIndex([{ kind: "file" }, { kind: "symlink" }], "file"),
    ).toBe(0);
    expect(inlineCreateRowIndex([], "file")).toBe(0);
  });

  it("keeps a new folder input at the beginning", () => {
    expect(
      inlineCreateRowIndex([{ kind: "dir" }, { kind: "file" }], "folder"),
    ).toBe(0);
  });
});
