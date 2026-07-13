interface DragPreviewLayoutOptions {
  pointerX: number;
  pointerY: number;
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  maxWidth?: number;
  offset?: number;
  margin?: number;
}

export function layoutDragPreview({
  pointerX,
  pointerY,
  sourceWidth,
  sourceHeight,
  viewportWidth,
  viewportHeight,
  maxWidth = 352,
  offset = 12,
  margin = 8,
}: DragPreviewLayoutOptions) {
  const width = Math.min(sourceWidth, maxWidth, viewportWidth - margin * 2);
  const height = sourceHeight;
  const maxLeft = viewportWidth - margin - width;
  const left = Math.max(margin, Math.min(pointerX + offset, maxLeft));

  const belowPointer = pointerY + offset;
  const abovePointer = pointerY - offset - height;
  const preferredTop =
    belowPointer + height <= viewportHeight - margin
      ? belowPointer
      : abovePointer;
  const maxTop = viewportHeight - margin - height;
  const top = Math.max(margin, Math.min(preferredTop, maxTop));

  return { left, top, width, height };
}
