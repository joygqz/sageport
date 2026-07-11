import { describe, expect, it } from "vitest";

import { getTabDropTarget } from "./tab-drag";

const stripRect = { left: 101, right: 501, width: 400 };
const tabRects = [
  { left: 101, right: 201, width: 100 },
  { left: 201, right: 301, width: 100 },
  { left: 301, right: 401, width: 100 },
];

describe("getTabDropTarget", () => {
  it("overlaps the editor pane's left border before the first tab", () => {
    expect(getTabDropTarget({ pointerX: 120, stripRect, tabRects })).toEqual({
      insertIndex: 0,
      indicatorX: 100,
    });
  });

  it("uses the preceding tab border for other insertion points", () => {
    expect(getTabDropTarget({ pointerX: 260, stripRect, tabRects })).toEqual({
      insertIndex: 2,
      indicatorX: 300,
    });
  });

  it("uses the final tab's border after the final tab", () => {
    expect(getTabDropTarget({ pointerX: 480, stripRect, tabRects })).toEqual({
      insertIndex: 3,
      indicatorX: 400,
    });
  });
});
