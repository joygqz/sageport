import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export const PANEL_HEADER_ACTION_CLASS = "size-[var(--toolbar-control-size)]";

export const PANEL_LIST_CLASS = "space-y-0.5";

export const PANEL_LIST_ITEM_CLASS =
  "group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-list-hover focus-within:bg-list-hover";

export const PANEL_LIST_ACTION_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[background-color,color,opacity] hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 group-focus-within:opacity-100";

export function PanelHeader({
  title,
  titleAfter,
  actions,
  className,
}: {
  title: ReactNode;
  titleAfter?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex h-[var(--workbench-bar-height)] shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/35 pl-4 pr-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-xs font-semibold tracking-[0.08em] text-surface-foreground/80">
          {title}
        </h2>
        {titleAfter}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          {actions}
        </div>
      )}
    </div>
  );
}

export function PanelContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="panel-content"
      className={cn("p-[var(--panel-gutter)]", className)}
      {...props}
    />
  );
}

interface PanelSectionHeaderProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
}

export const PanelSectionHeader = forwardRef<
  HTMLDivElement,
  PanelSectionHeaderProps
>(({ title, collapsed, onToggle, trailing, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "group flex h-8 items-center rounded-md transition-colors hover:bg-list-hover focus-within:bg-list-hover",
      className,
    )}
    {...props}
  >
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35"
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 shrink-0" />
      ) : (
        <ChevronDown className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{title}</span>
    </button>
    {trailing && (
      <div className="mr-1 flex min-w-6 shrink-0 items-center justify-center">
        {trailing}
      </div>
    )}
  </div>
));
PanelSectionHeader.displayName = "PanelSectionHeader";
