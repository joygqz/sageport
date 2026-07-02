import { useResizeHandle } from "@/lib/useResizeHandle";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  axis: "x" | "y";
  size: number;
  onResize: (size: number) => void;
  reverse?: boolean;
  className?: string;
}

/**
 * A draggable divider for resizing an adjacent panel, VSCode-style: a 1px
 * line matching the app's normal borders at rest, widening only in color
 * (not thickness) on hover/drag. The handle itself takes up zero layout
 * space (so it never leaves a colored gap between the two panels it sits
 * between) — the wider grab target is an absolutely positioned overlay
 * that spills onto the neighboring panels without affecting their size.
 */
export function ResizeHandle({
  axis,
  size,
  onResize,
  reverse,
  className,
}: ResizeHandleProps) {
  const onPointerDown = useResizeHandle({ axis, size, reverse, onResize });
  return (
    <div
      className={cn(
        "group relative z-10 shrink-0 select-none",
        axis === "x" ? "w-0" : "h-0",
        className,
      )}
    >
      <div
        className={cn(
          "absolute bg-border transition-colors group-hover:bg-primary group-active:bg-primary",
          axis === "x"
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
      <div
        onPointerDown={onPointerDown}
        className={cn(
          "absolute",
          axis === "x"
            ? "inset-y-0 -left-1.5 -right-1.5 cursor-col-resize"
            : "inset-x-0 -top-1.5 -bottom-1.5 cursor-row-resize",
        )}
      />
    </div>
  );
}
