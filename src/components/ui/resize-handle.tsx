import { useEffect, useId, useRef, useState } from "react";
import { create } from "zustand";

import { isPointerDragActive, trackPointerDrag } from "@/lib/pointerDrag";
import { cn } from "@/lib/utils";

/**
 * Sashes lit up by a gesture rather than plain CSS hover: dragging a sash,
 * or hovering/dragging a corner that drives two sashes at once. Keyed by
 * sash id so a corner on one sash can light up the orthogonal one, which
 * lives elsewhere in the tree (VSCode highlights both through a corner
 * gesture).
 */
const useHotSashes = create<{ hot: Record<string, true> }>(() => ({
  hot: {},
}));

function setHot(ids: string[], on: boolean) {
  useHotSashes.setState((s) => {
    const hot = { ...s.hot };
    for (const id of ids) {
      if (on) hot[id] = true;
      else delete hot[id];
    }
    return { hot };
  });
}

/** The orthogonal sash a corner also drives, mirroring that sash's props. */
export interface CornerTarget {
  /** `sashId` of the orthogonal sash, so it highlights during the gesture. */
  targetId: string;
  size: number;
  reverse?: boolean;
  onResize: (size: number) => void;
}

interface ResizeHandleProps {
  axis: "x" | "y";
  /** Current size in px. Alternatively provide `getSize`. */
  size?: number;
  /**
   * Reads the current size live at gesture time — for sizes derived from a
   * ratio or a measured container, where a render-baked `size` would go
   * stale between renders. Takes precedence over `size`.
   */
  getSize?: () => number;
  onResize: (size: number) => void;
  reverse?: boolean;
  className?: string;
  /** Stable id other sashes' corners can reference via `targetId`. */
  sashId?: string;
  /**
   * Live drag bounds, queried at gesture time (they move with the window,
   * zoom and sibling panels). When given, the sash switches to VSCode's
   * one-directional cursors at the limits — e.g. `e-resize` when the panel
   * is at its minimum and can only grow east — both while hovering and
   * live during a drag.
   */
  limits?: () => { min: number; max: number };
  /**
   * VSCode-style corner drags where this sash's ends meet an orthogonal
   * sash: a small square at the junction resizes both panels at once and
   * highlights both sashes. `start` is the left/top end, `end` the
   * right/bottom end.
   */
  startCorner?: CornerTarget;
  endCorner?: CornerTarget;
}

/**
 * A draggable divider for resizing an adjacent panel, VSCode-style: a 1px
 * line matching the app's normal borders at rest; hovering or dragging
 * fades in VSCode's 4px accent band over it — after VSCode's short hover
 * delay, so sweeping the pointer across a sash doesn't flash it. The
 * handle itself takes up zero layout space (so it never leaves a colored
 * gap between the two panels it sits between) — the band and the wider
 * grab target are absolutely positioned overlays that spill onto the
 * neighboring panels without affecting their size.
 */
export function ResizeHandle({
  axis,
  size = 0,
  getSize,
  onResize,
  reverse = false,
  className,
  sashId,
  limits,
  startCorner,
  endCorner,
}: ResizeHandleProps) {
  const autoId = useId();
  const id = sashId ?? autoId;
  const hot = useHotSashes((s) => s.hot[id] === true);
  /** Cursor for the grab overlay, refreshed when a gesture touches it. */
  const [hoverCursor, setHoverCursor] = useState<string | null>(null);

  const defaultCursor = axis === "x" ? "col-resize" : "row-resize";

  // Which way can the drag still go if the panel were `value` px? Maps to
  // VSCode's cursors: both ways → col/row-resize, one way → the directional
  // e/w/n/s-resize, no way (window too small) → plain arrow.
  const cursorAt = (value: number) => {
    if (!limits) return defaultCursor;
    const { min, max } = limits();
    if (min >= max) return "default";
    const grow = axis === "x" ? "e-resize" : "s-resize";
    const shrink = axis === "x" ? "w-resize" : "n-resize";
    if (value <= min) return reverse ? shrink : grow;
    if (value >= max) return reverse ? grow : shrink;
    return defaultCursor;
  };

  const liveSize = () => getSize?.() ?? size;

  const onPointerDown = (e: React.PointerEvent) => {
    const startSize = liveSize();
    setHot([id], true);
    let cursor = cursorAt(startSize);
    trackPointerDrag(
      e,
      cursor,
      (dx, dy) => {
        const delta = axis === "x" ? dx : dy;
        const next = startSize + (reverse ? -delta : delta);
        onResize(next);
        cursor = cursorAt(next);
        return cursor;
      },
      () => {
        setHot([id], false);
        setHoverCursor(cursor);
      },
    );
  };

  return (
    // The pieces layer flat in the ancestor stacking context — line (10) <
    // highlight band (20) < grab target (30) < corner (40) — so the
    // container must NOT create a context of its own (no z-index here):
    // that's what lets one sash's band paint over another sash's resting
    // line where they cross, and corners win the junction pixels over the
    // neighboring sashes' grab strips regardless of DOM order.
    <div
      className={cn(
        "group relative shrink-0 select-none",
        axis === "x" ? "w-0" : "h-0",
        className,
      )}
    >
      <div
        className={cn(
          "absolute z-10 bg-border",
          axis === "x"
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
      {/* w-1/h-1 = 4px at zoom 0 (VSCode's sash size), rem-based so the
          band scales with the UI zoom like everything else. */}
      <div
        className={cn(
          "absolute z-20 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-hover:delay-300",
          axis === "x"
            ? "inset-y-0 left-1/2 w-1 -translate-x-1/2"
            : "inset-x-0 top-1/2 h-1 -translate-y-1/2",
        )}
        // A gesture-driven highlight beats the CSS hover rules (and their
        // hover delay): inline style so it wins regardless of rule order.
        style={hot ? { opacity: 1, transitionDelay: "0ms" } : undefined}
      />
      <div
        onPointerDown={onPointerDown}
        onPointerEnter={() => {
          if (!isPointerDragActive()) setHoverCursor(cursorAt(liveSize()));
        }}
        className={cn(
          "absolute z-30",
          axis === "x"
            ? "inset-y-0 -left-1.5 -right-1.5"
            : "inset-x-0 -top-1.5 -bottom-1.5",
        )}
        style={{ cursor: hoverCursor ?? defaultCursor }}
      />
      {startCorner && (
        <Corner
          ownId={id}
          axis={axis}
          position="start"
          own={{ size, reverse, onResize }}
          target={startCorner}
        />
      )}
      {endCorner && (
        <Corner
          ownId={id}
          axis={axis}
          position="end"
          own={{ size, reverse, onResize }}
          target={endCorner}
        />
      )}
    </div>
  );
}

/**
 * The junction square where two orthogonal sashes meet. Dragging it feeds
 * the pointer's own-axis delta to this sash and the cross-axis delta to the
 * orthogonal one, so both panels resize in a single gesture; hovering (or
 * dragging) marks both sashes hot. Diagonal cursors assume the workbench
 * geometry — panels dock left/right of the corner and below it — matching
 * how VSCode orients its orthogonal drag handles.
 */
function Corner({
  ownId,
  axis,
  position,
  own,
  target,
}: {
  ownId: string;
  axis: "x" | "y";
  position: "start" | "end";
  own: { size: number; reverse: boolean; onResize: (size: number) => void };
  target: CornerTarget;
}) {
  const ids = [ownId, target.targetId];
  const hovered = useRef(false);
  const dragging = useRef(false);
  /** Sash ids lit by the gesture currently holding this corner. */
  const lit = useRef<string[]>([]);

  // If the corner unmounts while merely hovered (a layout toggle), drop the
  // highlight it holds. A drag in flight is different: its window-level
  // pointerup outlives the unmount (that's how a snap-closed panel can be
  // dragged back open) and clears the highlight itself — clearing here
  // would strip the orthogonal sash mid-drag.
  useEffect(
    () => () => {
      if (hovered.current && !dragging.current) setHot(lit.current, false);
      hovered.current = false;
    },
    [],
  );

  const cursor = position === "start" ? "nesw-resize" : "nwse-resize";

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    lit.current = ids;
    setHot(ids, true);
    const ownStart = own.size;
    const targetStart = target.size;
    trackPointerDrag(
      e,
      cursor,
      (dx, dy) => {
        const ownDelta = axis === "y" ? dy : dx;
        const targetDelta = axis === "y" ? dx : dy;
        own.onResize(ownStart + (own.reverse ? -ownDelta : ownDelta));
        target.onResize(
          targetStart + (target.reverse ? -targetDelta : targetDelta),
        );
      },
      () => {
        // Pointer capture kept boundary events away for the whole drag, so
        // `hovered` may be stale — always unlight; if the pointer really is
        // still on the corner, the next move re-enters and re-lights.
        dragging.current = false;
        hovered.current = false;
        setHot(ids, false);
      },
    );
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={() => {
        if (isPointerDragActive()) return;
        hovered.current = true;
        lit.current = ids;
        setHot(ids, true);
      }}
      onPointerLeave={() => {
        // Only unlight a hover this instance actually claimed. A drag that
        // outlived a snap-close/reopen cycle sweeps the pointer across the
        // remounted corner: enter was ignored (drag active), so leave must
        // not strip the drag's own highlight either.
        if (!hovered.current) return;
        hovered.current = false;
        if (!dragging.current) setHot(ids, false);
      }}
      className={cn(
        "absolute z-40",
        axis === "x"
          ? cn("-inset-x-1.5 h-3", position === "start" ? "-top-1.5" : "-bottom-1.5")
          : cn("-inset-y-1.5 w-3", position === "start" ? "-left-1.5" : "-right-1.5"),
      )}
      style={{ cursor }}
    />
  );
}
