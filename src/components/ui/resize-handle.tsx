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
 * (not thickness) on hover/drag. The hit area is wider than the visible
 * line so it's easy to grab.
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
      onPointerDown={onPointerDown}
      className={cn(
        "group relative shrink-0 select-none",
        axis === "x" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        className,
      )}
    >
      <div
        className={cn(
          "absolute bg-border transition-colors group-hover:bg-primary group-active:bg-primary",
          axis === "x"
            ? cn("inset-y-0 w-px", reverse ? "right-0" : "left-0")
            : cn("inset-x-0 h-px", reverse ? "bottom-0" : "top-0"),
        )}
      />
    </div>
  );
}
