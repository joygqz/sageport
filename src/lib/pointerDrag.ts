import { useEffect } from "react";

let dragCount = 0;

export function isPointerDragActive() {
  return dragCount > 0;
}

export function useDragCursor(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const style = document.createElement("style");
    style.textContent = "* { cursor: default !important; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}

export function trackPointerDrag(
  e: React.PointerEvent,
  cursor: string,
  onMove: (dx: number, dy: number) => string | void,
  onEnd?: () => void,
) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  dragCount++;

  e.currentTarget.setPointerCapture(e.pointerId);
  const style = document.createElement("style");
  const setCursor = (c: string) => {
    style.textContent = `* { cursor: ${c} !important; }`;
  };
  setCursor(cursor);
  document.head.appendChild(style);
  let current = cursor;
  const handleMove = (ev: PointerEvent) => {
    const next = onMove(ev.clientX - startX, ev.clientY - startY);
    if (next && next !== current) {
      current = next;
      setCursor(next);
    }
  };
  const handleUp = () => {
    dragCount--;
    style.remove();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    onEnd?.();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}
