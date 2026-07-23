import { describe, expect, it } from "vitest";

import type { FileEntry } from "@/types/models";
import {
  DEFAULT_FILE_SORT,
  inlineCreateBlurAction,
  inlineCreateRowIndex,
  visibleFileEntries,
} from "./file-list-layout";

function entry(
  name: string,
  kind: FileEntry["kind"] = "file",
  size = 0,
  modified: number | null = 0,
): FileEntry {
  return {
    name,
    path: `/${name}`,
    kind,
    size,
    modified,
    permissions: null,
    isSymlink: false,
  };
}

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

describe("visibleFileEntries", () => {
  const entries = [
    entry("z-folder", "dir", 0, 30),
    entry("a-folder", "dir", 0, 10),
    entry("report-10.txt", "file", 10, 20),
    entry("report-2.txt", "file", 2, null),
    { ...entry(".env", "file", 1, 40), hidden: true },
  ];

  it("filters hidden entries and matches names without case sensitivity", () => {
    expect(
      visibleFileEntries(entries, false, "REPORT", DEFAULT_FILE_SORT).map(
        (item) => item.name,
      ),
    ).toEqual(["report-2.txt", "report-10.txt"]);
    expect(
      visibleFileEntries(entries, true, ".ENV", DEFAULT_FILE_SORT).map(
        (item) => item.name,
      ),
    ).toEqual([".env"]);
  });

  it("keeps folders first and sorts files by size", () => {
    expect(
      visibleFileEntries(entries, false, "", {
        key: "size",
        direction: "descending",
      }).map((item) => item.name),
    ).toEqual(["a-folder", "z-folder", "report-10.txt", "report-2.txt"]);
  });

  it("places unknown modification times last in either direction", () => {
    expect(
      visibleFileEntries(entries, false, "report", {
        key: "modified",
        direction: "descending",
      }).map((item) => item.name),
    ).toEqual(["report-10.txt", "report-2.txt"]);
    expect(
      visibleFileEntries(entries, false, "report", {
        key: "modified",
        direction: "ascending",
      }).map((item) => item.name),
    ).toEqual(["report-10.txt", "report-2.txt"]);
  });
});
