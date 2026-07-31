import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export const PANEL_HEADER_ACTION_CLASS = "size-[var(--toolbar-control-size)]";

export const PANEL_LIST_CLASS = "space-y-0.5";

export const PANEL_LIST_ITEM_CLASS =
  "group flex min-h-[var(--list-row-height)] items-center gap-2 rounded-md px-2 py-1 outline-none transition-colors hover:bg-list-hover focus-within:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45";

export const PANEL_LIST_ICON_CLASS =
  "flex size-[var(--toolbar-control-size)] shrink-0 items-center justify-center rounded-md border border-border-subtle bg-muted/25 text-muted-foreground";

export const PANEL_LIST_ACTION_CLASS =
  "panel-list-action pointer-events-none -ml-2 flex h-6 w-0 shrink-0 items-center justify-center overflow-hidden rounded-md text-muted-foreground opacity-0 transition-[background-color,color,opacity] hover:bg-accent hover:text-foreground group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:ml-0 group-focus-within:w-6 group-focus-within:opacity-100";

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
        "flex h-[var(--workbench-bar-height)] shrink-0 items-center justify-between gap-2 border-b border-border-subtle bg-surface/70 pl-3 pr-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="min-w-0 truncate text-xs font-semibold leading-snug tracking-wide text-surface-foreground/85">
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
      className={cn(
        "flex min-h-0 flex-1 flex-col p-[var(--panel-gutter)]",
        className,
      )}
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
  trailingClassName?: string;
}

export const PanelSectionHeader = forwardRef<
  HTMLDivElement,
  PanelSectionHeaderProps
>(
  (
    {
      title,
      collapsed,
      onToggle,
      trailing,
      trailingClassName,
      className,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "group flex h-[var(--control-height-sm)] items-center rounded-md transition-colors hover:bg-list-hover focus-within:bg-list-hover",
        className,
      )}
      {...props}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{title}</span>
      </button>
      {trailing && (
        <div
          className={cn(
            "mr-1 flex min-w-6 shrink-0 items-center justify-center",
            trailingClassName,
          )}
        >
          {trailing}
        </div>
      )}
    </div>
  ),
);
PanelSectionHeader.displayName = "PanelSectionHeader";
