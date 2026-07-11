export interface HorizontalRect {
  left: number;
  right: number;
  width: number;
}

export interface TabDropTarget {
  insertIndex: number;
  indicatorX: number;
}

/**
 * Resolves a tab insertion point from the pointer position. The tab strip sits
 * inside the editor pane's one-pixel left border, so the first insertion marker
 * deliberately occupies that border rather than the strip's content edge.
 */
export function getTabDropTarget({
  pointerX,
  stripRect,
  tabRects,
}: {
  pointerX: number;
  stripRect: HorizontalRect;
  tabRects: Array<HorizontalRect | null>;
}): TabDropTarget {
  const insertIndex = tabRects.findIndex(
    (rect) => rect !== null && pointerX < rect.left + rect.width / 2,
  );
  const targetIndex = insertIndex === -1 ? tabRects.length : insertIndex;

  if (targetIndex === 0) {
    return {
      insertIndex: targetIndex,
      indicatorX: stripRect.left - 1,
    };
  }

  return {
    insertIndex: targetIndex,
    indicatorX: (tabRects[targetIndex - 1]?.right ?? stripRect.right) - 1,
  };
}
