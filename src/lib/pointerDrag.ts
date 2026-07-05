let dragCount = 0;

/**
 * True while any sash drag is in flight. Drags track the whole window, so
 * hover handlers on other sashes/corners use this to ignore the pointer
 * merely sweeping across them mid-drag.
 */
export function isPointerDragActive() {
  return dragCount > 0;
}

/**
 * Low-level pointer-drag tracker shared by the sash components: starts on a
 * pointerdown and reports cumulative deltas across the whole window (not
 * just the origin element) until release, VSCode-style.
 *
 * While dragging, the pointer is captured to the grabbed element so other
 * elements' hover states can't flip, and the drag cursor is forced through
 * a `* { cursor: … !important }` rule (VSCode does the same) — a plain body
 * cursor loses to any element declaring its own. `onMove` may return a new
 * cursor to switch to mid-drag (e.g. the directional at-limit cursors).
 */
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
  // Implicitly released on pointerup; if the grabbed element unmounts
  // mid-drag (a panel snap-closing), the window listeners below still see
  // the drag through, only the hover shielding is lost.
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
