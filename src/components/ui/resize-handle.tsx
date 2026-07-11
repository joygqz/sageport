import { useEffect, useId, useRef, useState } from "react";
import { create } from "zustand";

import { isPointerDragActive, trackPointerDrag } from "@/lib/pointerDrag";
import { cn } from "@/lib/utils";

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

export interface CornerTarget {
  targetId: string;
  size: number;
  reverse?: boolean;
  onResize: (size: number) => void;
}

interface ResizeHandleProps {
  axis: "x" | "y";

  size?: number;

  getSize?: () => number;
  onResize: (size: number) => void;
  reverse?: boolean;
  className?: string;
  showLine?: boolean;

  sashId?: string;

  limits?: () => { min: number; max: number };

  startCorner?: CornerTarget;
  endCorner?: CornerTarget;
}

export function ResizeHandle({
  axis,
  size = 0,
  getSize,
  onResize,
  reverse = false,
  className,
  showLine = true,
  sashId,
  limits,
  startCorner,
  endCorner,
}: ResizeHandleProps) {
  const autoId = useId();
  const id = sashId ?? autoId;
  const hot = useHotSashes((s) => s.hot[id] === true);

  const [hoverCursor, setHoverCursor] = useState<string | null>(null);

  const defaultCursor = axis === "x" ? "col-resize" : "row-resize";

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
    <div
      className={cn(
        "group relative shrink-0 select-none",
        axis === "x" ? "w-0" : "h-0",
        className,
      )}
    >
      {showLine && (
        <div
          className={cn(
            "absolute z-10 bg-border",
            axis === "x"
              ? cn("inset-y-0 w-px", reverse ? "left-1/2" : "right-1/2")
              : cn("inset-x-0 h-px", reverse ? "top-1/2" : "bottom-1/2"),
          )}
        />
      )}
      <div
        className={cn(
          "absolute z-20 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-hover:delay-300",
          axis === "x"
            ? "inset-y-0 left-1/2 w-1 -translate-x-1/2"
            : "inset-x-0 top-1/2 h-1 -translate-y-1/2",
        )}

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

  const lit = useRef<string[]>([]);

  useEffect(
    () => () => {
      if (hovered.current && !dragging.current) setHot(lit.current, false);
      hovered.current = false;
    },
    [],
  );

  const cursor = "move";

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
        if (!hovered.current) return;
        hovered.current = false;
        if (!dragging.current) setHot(ids, false);
      }}
      className={cn(
        "absolute z-40",
        axis === "x"
          ? cn(
              "-inset-x-1.5 h-3",
              position === "start" ? "-top-1.5" : "-bottom-1.5",
            )
          : cn(
              "-inset-y-1.5 w-3",
              position === "start" ? "-left-1.5" : "-right-1.5",
            ),
      )}
      style={{ cursor }}
    />
  );
}
