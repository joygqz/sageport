export const WORKBENCH_TAB_CLASS =
  "group relative flex h-[var(--workbench-tab-height)] w-fit max-w-52 gap-1.5 pl-3 pr-1.5 shrink-0 cursor-pointer touch-none select-none items-center rounded-b-md bg-[var(--tab-background)] text-xs outline-none [--tab-background:var(--color-surface)] transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45 has-[[data-slot=tabs-trigger]:focus-visible]:ring-2 has-[[data-slot=tabs-trigger]:focus-visible]:ring-inset has-[[data-slot=tabs-trigger]:focus-visible]:ring-ring/45";

export const WORKBENCH_TAB_TRIGGER_CLASS =
  "flex min-w-0 flex-1 items-center justify-start gap-2 self-stretch rounded-b-md text-left outline-none";

export const WORKBENCH_TAB_LABEL_CLASS = "min-w-0 max-w-36 truncate text-left";

export const STATUS_DOT_CLASS: Record<
  "idle" | "connecting" | "connected" | "closed" | "error",
  string
> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export const WORKBENCH_TAB_STRIP_GUTTER_CLASS = "p-1";

export const WORKBENCH_COMPACT_TAB_STRIP_GUTTER_CLASS = "p-1";

export const WORKBENCH_ITEM_ACTIVE_CLASS =
  "bg-list-active text-list-active-foreground";

export const WORKBENCH_ITEM_INACTIVE_CLASS =
  "text-muted-foreground hover:bg-list-hover hover:text-foreground";

export const WORKBENCH_TAB_ACTIVE_CLASS =
  "text-foreground shadow-[inset_0_1.5px_0_var(--primary)] [--tab-background:var(--color-tab-active)]";

export const WORKBENCH_TAB_INACTIVE_CLASS =
  "text-muted-foreground hover:text-foreground hover:[--tab-background:var(--color-list-hover)]";

export const WORKBENCH_TAB_CLOSE_CLASS =
  "flex size-5 shrink-0 items-center justify-center overflow-hidden rounded text-current opacity-70 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60";

export const WORKBENCH_TAB_CLOSE_INACTIVE_CLASS =
  "workbench-tab-close-inactive pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-70 group-focus-within:pointer-events-auto group-focus-within:opacity-70";

export const WORKBENCH_TAB_DROP_INDICATOR_CLASS =
  "pointer-events-none fixed z-[1000] w-0.5 rounded-full bg-primary";
