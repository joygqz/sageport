export interface HorizontalRect {
  left: number;
  right: number;
  width: number;
}

export interface TabDropTarget {
  insertIndex: number;
  indicatorX: number;
}

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
  const previous = findPreviousRect(tabRects, targetIndex);
  const next = findNextRect(tabRects, targetIndex);
  let indicatorX: number;

  if (previous && next) {
    indicatorX = (previous.right + next.left) / 2;
  } else if (next) {
    indicatorX = (stripRect.left + next.left) / 2;
  } else if (previous) {
    const beforePrevious = findPreviousRect(tabRects, targetIndex - 1);
    const trailingGap = beforePrevious
      ? Math.max(0, previous.left - beforePrevious.right)
      : Math.max(0, previous.left - stripRect.left);
    indicatorX = previous.right + trailingGap / 2;
  } else {
    indicatorX = stripRect.left;
  }

  return {
    insertIndex: targetIndex,
    indicatorX: clampIndicatorToStrip(indicatorX, stripRect),
  };
}

function clampIndicatorToStrip(
  indicatorX: number,
  stripRect: HorizontalRect,
): number {
  const inset = Math.min(1, stripRect.width / 2);
  return Math.min(
    stripRect.right - inset,
    Math.max(stripRect.left + inset, indicatorX),
  );
}

function findPreviousRect(
  rects: Array<HorizontalRect | null>,
  beforeIndex: number,
): HorizontalRect | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const rect = rects[index];
    if (rect) return rect;
  }
  return null;
}

function findNextRect(
  rects: Array<HorizontalRect | null>,
  fromIndex: number,
): HorizontalRect | null {
  for (let index = fromIndex; index < rects.length; index += 1) {
    const rect = rects[index];
    if (rect) return rect;
  }
  return null;
}
