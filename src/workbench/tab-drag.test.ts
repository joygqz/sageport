import { describe, expect, it } from "vitest";

import { getTabDropTarget } from "./tab-drag";

const stripRect = { left: 100, right: 500, width: 400 };
const tabRects = [
  { left: 108, right: 208, width: 100 },
  { left: 212, right: 312, width: 100 },
  { left: 316, right: 416, width: 100 },
];

describe("getTabDropTarget", () => {
  it("centers the marker in the leading gutter", () => {
    expect(getTabDropTarget({ pointerX: 120, stripRect, tabRects })).toEqual({
      insertIndex: 0,
      indicatorX: 104,
    });
  });

  it("centers the marker in the gap between tabs", () => {
    expect(getTabDropTarget({ pointerX: 320, stripRect, tabRects })).toEqual({
      insertIndex: 2,
      indicatorX: 314,
    });
  });

  it("centers the marker in a trailing gap matching the tab spacing", () => {
    expect(getTabDropTarget({ pointerX: 480, stripRect, tabRects })).toEqual({
      insertIndex: 3,
      indicatorX: 418,
    });
  });

  it("uses the leading gutter as the trailing gap for a single tab", () => {
    expect(
      getTabDropTarget({ pointerX: 480, stripRect, tabRects: [tabRects[0]] }),
    ).toEqual({
      insertIndex: 1,
      indicatorX: 212,
    });
  });

  it("keeps the marker inside the leading edge when tabs are scrolled out", () => {
    const scrolledTabRects = [
      { left: -120, right: -20, width: 100 },
      { left: -16, right: 84, width: 100 },
      { left: 88, right: 188, width: 100 },
    ];

    expect(
      getTabDropTarget({
        pointerX: 90,
        stripRect,
        tabRects: scrolledTabRects,
      }),
    ).toEqual({
      insertIndex: 2,
      indicatorX: 101,
    });
  });

  it("keeps the marker inside the trailing edge when tabs overflow", () => {
    const overflowingTabRects = [
      { left: 420, right: 520, width: 100 },
      { left: 524, right: 624, width: 100 },
    ];

    expect(
      getTabDropTarget({
        pointerX: 640,
        stripRect,
        tabRects: overflowingTabRects,
      }),
    ).toEqual({
      insertIndex: 2,
      indicatorX: 499,
    });
  });
});
