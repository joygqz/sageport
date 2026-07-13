import { describe, expect, it } from "vitest";

import { layoutDragPreview } from "./dragPreview";

describe("layoutDragPreview", () => {
  it("caps wide source rows to a compact preview", () => {
    expect(
      layoutDragPreview({
        pointerX: 127,
        pointerY: 98,
        sourceWidth: 1240,
        sourceHeight: 28,
        viewportWidth: 1992,
        viewportHeight: 505,
      }),
    ).toEqual({ left: 139, top: 110, width: 352, height: 28 });
  });

  it("keeps the preview inside the right and bottom edges", () => {
    expect(
      layoutDragPreview({
        pointerX: 490,
        pointerY: 290,
        sourceWidth: 240,
        sourceHeight: 28,
        viewportWidth: 500,
        viewportHeight: 300,
      }),
    ).toEqual({ left: 252, top: 250, width: 240, height: 28 });
  });

  it("preserves a narrow source row width", () => {
    expect(
      layoutDragPreview({
        pointerX: 40,
        pointerY: 40,
        sourceWidth: 220,
        sourceHeight: 28,
        viewportWidth: 800,
        viewportHeight: 600,
      }).width,
    ).toBe(220);
  });
});
