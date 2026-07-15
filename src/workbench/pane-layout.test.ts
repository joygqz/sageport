import { describe, expect, it } from "vitest";

import {
  layoutExtent,
  layoutPaneIds,
  leafLayout,
  neighborPaneId,
  removeLayoutPane,
  resizeSplitNode,
  splitLayout,
  type PaneLayout,
} from "./pane-layout";

function split(layout: PaneLayout, target: string, next: string, dir: "row" | "column") {
  return splitLayout(layout, target, next, dir);
}

describe("splitLayout", () => {
  it("wraps a leaf into a two-child split", () => {
    const layout = split(leafLayout("a"), "a", "b", "row");
    expect(layout).toMatchObject({
      type: "split",
      direction: "row",
      sizes: [0.5, 0.5],
    });
    expect(layoutPaneIds(layout)).toEqual(["a", "b"]);
  });

  it("inserts a sibling when the direction matches, halving the source size", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = resizeSplitNode(
      layout,
      (layout as Extract<PaneLayout, { type: "split" }>).id,
      [0.6, 0.4],
    );
    layout = split(layout, "a", "c", "row");
    expect(layoutPaneIds(layout)).toEqual(["a", "c", "b"]);
    expect(
      (layout as Extract<PaneLayout, { type: "split" }>).sizes,
    ).toEqual([0.3, 0.3, 0.4]);
  });

  it("nests a split when the direction differs", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "column");
    const root = layout as Extract<PaneLayout, { type: "split" }>;
    expect(root.direction).toBe("row");
    expect(root.children[1]).toMatchObject({
      type: "split",
      direction: "column",
    });
    expect(layoutPaneIds(layout)).toEqual(["a", "b", "c"]);
  });

  it("returns the same node when the target is missing", () => {
    const layout = split(leafLayout("a"), "a", "b", "row");
    expect(split(layout, "missing", "c", "row")).toBe(layout);
  });
});

describe("removeLayoutPane", () => {
  it("collapses a two-child split back to a leaf", () => {
    const layout = split(leafLayout("a"), "a", "b", "row");
    expect(removeLayoutPane(layout, "b")).toEqual(leafLayout("a"));
  });

  it("renormalizes the remaining sizes", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "row");
    const removed = removeLayoutPane(layout, "a") as Extract<
      PaneLayout,
      { type: "split" }
    >;
    expect(layoutPaneIds(removed)).toEqual(["b", "c"]);
    expect(removed.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("collapses nested splits left with a single child", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "column");
    const removed = removeLayoutPane(layout, "c") as Extract<
      PaneLayout,
      { type: "split" }
    >;
    expect(removed.children[1]).toEqual(leafLayout("b"));
    expect(layoutPaneIds(removed)).toEqual(["a", "b"]);
  });

  it("returns null when removing the last pane", () => {
    expect(removeLayoutPane(leafLayout("a"), "a")).toBeNull();
  });
});

describe("neighborPaneId", () => {
  it("prefers the following pane, falling back to the previous one", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "row");
    expect(neighborPaneId(layout, "b")).toBe("c");
    expect(neighborPaneId(layout, "c")).toBe("b");
    expect(neighborPaneId(layout, "missing")).toBeNull();
  });
});

describe("layoutExtent", () => {
  it("reports 1 on both axes for a lone leaf", () => {
    expect(layoutExtent(leafLayout("a"), "row")).toBe(1);
    expect(layoutExtent(leafLayout("a"), "column")).toBe(1);
  });

  it("sums along the matching axis and takes the max across the other", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "row");
    expect(layoutExtent(layout, "row")).toBe(3);
    expect(layoutExtent(layout, "column")).toBe(1);
  });

  it("projects nested splits onto the grid axes", () => {
    // row[a, column[b, row[d, e]], c] — visually 4 panes wide on the bottom band
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "row");
    layout = split(layout, "b", "d", "column");
    layout = split(layout, "d", "e", "row");
    expect(layoutExtent(layout, "row")).toBe(4);
    expect(layoutExtent(layout, "column")).toBe(2);
  });

  it("caps a full 3x2 grid at its outer dimensions", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    layout = split(layout, "b", "c", "row");
    layout = split(layout, "a", "d", "column");
    layout = split(layout, "b", "e", "column");
    layout = split(layout, "c", "f", "column");
    expect(layoutExtent(layout, "row")).toBe(3);
    expect(layoutExtent(layout, "column")).toBe(2);
  });
});

describe("resizeSplitNode", () => {
  it("applies sizes only to the matching split and rejects length mismatches", () => {
    let layout = split(leafLayout("a"), "a", "b", "row");
    const id = (layout as Extract<PaneLayout, { type: "split" }>).id;
    layout = resizeSplitNode(layout, id, [0.7, 0.3]);
    expect(
      (layout as Extract<PaneLayout, { type: "split" }>).sizes,
    ).toEqual([0.7, 0.3]);
    expect(resizeSplitNode(layout, id, [1])).toBe(layout);
    expect(resizeSplitNode(layout, "other", [0.2, 0.8])).toBe(layout);
  });
});
