import { useCallback } from "react";

interface UseResizeHandleOptions {
  /** Drag axis: "x" resizes width, "y" resizes height. */
  axis: "x" | "y";
  /** Current size in px, baked into the handler on every render. */
  size: number;
  /** Flip the delta so dragging toward the panel's far edge still grows it. */
  reverse?: boolean;
  onResize: (size: number) => void;
}

/**
 * VSCode-style drag-to-resize: grab a thin border handle and track the
 * pointer across the whole window (not just the handle) until release.
 */
export function useResizeHandle({
  axis,
  size,
  reverse = false,
  onResize,
}: UseResizeHandleOptions) {
  return useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const start = axis === "x" ? e.clientX : e.clientY;
      const startSize = size;
      // Pin the resize cursor for the whole drag, even when the pointer
      // leaves the thin handle or crosses an iframe/canvas.
      const cursor = axis === "x" ? "col-resize" : "row-resize";
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = cursor;
      const onMove = (ev: PointerEvent) => {
        const pos = axis === "x" ? ev.clientX : ev.clientY;
        const delta = pos - start;
        onResize(startSize + (reverse ? -delta : delta));
      };
      const onUp = () => {
        document.body.style.cursor = prevCursor;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [axis, size, reverse, onResize],
  );
}
