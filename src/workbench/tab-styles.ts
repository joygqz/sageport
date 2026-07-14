export const WORKBENCH_TAB_CLASS =
  "group relative flex shrink-0 cursor-pointer touch-none select-none items-center rounded-lg bg-[var(--tab-background)] text-xs outline-none [--tab-background:var(--color-surface)] transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45";

export const WORKBENCH_TAB_STRIP_GUTTER_CLASS = "p-1.5";

export const WORKBENCH_COMPACT_TAB_STRIP_GUTTER_CLASS = "p-1";

export const WORKBENCH_ITEM_ACTIVE_CLASS =
  "bg-list-active text-list-active-foreground";

export const WORKBENCH_ITEM_INACTIVE_CLASS =
  "text-muted-foreground hover:bg-list-hover hover:text-foreground";

export const WORKBENCH_TAB_ACTIVE_CLASS =
  "text-list-active-foreground [--tab-background:var(--color-tab-active)]";

export const WORKBENCH_TAB_INACTIVE_CLASS =
  "text-muted-foreground hover:text-foreground hover:[--tab-background:var(--color-list-hover)]";

export const WORKBENCH_TAB_CLOSE_CLASS =
  "flex shrink-0 items-center justify-center overflow-hidden rounded text-current opacity-70 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/35";

export const WORKBENCH_TAB_DROP_INDICATOR_CLASS =
  "pointer-events-none fixed z-[1000] w-0.5 rounded-full bg-primary";
