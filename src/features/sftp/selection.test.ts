import { describe, expect, it } from "vitest";

import { nextFileSelection } from "./selection";

const paths = ["/a", "/b", "/c", "/d"];

describe("file selection", () => {
  it("toggles individual files with Ctrl or Command", () => {
    expect(
      nextFileSelection({
        paths,
        selected: ["/a"],
        target: "/c",
        anchor: "/a",
        toggle: true,
      }).selected,
    ).toEqual(["/a", "/c"]);
  });

  it("selects a contiguous range with Shift", () => {
    expect(
      nextFileSelection({
        paths,
        selected: ["/b"],
        target: "/d",
        anchor: "/b",
        range: true,
      }).selected,
    ).toEqual(["/b", "/c", "/d"]);
  });

  it("adds a range to the current selection with Shift plus modifier", () => {
    expect(
      nextFileSelection({
        paths,
        selected: ["/a"],
        target: "/d",
        anchor: "/c",
        range: true,
        toggle: true,
      }).selected,
    ).toEqual(["/a", "/c", "/d"]);
  });
});
