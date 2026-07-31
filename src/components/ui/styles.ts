export const CONTROL_BORDER_CLASS = "border-border-strong hover:border-ring/70";

export const CONTROL_FOCUS_CLASS =
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

export const INTERACTIVE_FOCUS_CLASS =
  "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/45";

export const CONTROL_INTERACTION_CLASS = `${CONTROL_BORDER_CLASS} ${CONTROL_FOCUS_CLASS}`;

export const CONTROL_BASE_CLASS = `w-full rounded-md border bg-surface-raised text-foreground shadow-[inset_0_1px_color-mix(in_oklch,var(--color-foreground)_2%,transparent)] transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/35 ${CONTROL_INTERACTION_CLASS}`;

export const CONTROL_CONTAINER_CLASS =
  "rounded-md border border-border-strong bg-surface-raised transition-[background-color,border-color,box-shadow] hover:border-ring/70 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35";

export const POPOVER_CONTENT_CLASS =
  "z-50 min-w-40 overflow-hidden rounded-lg border border-border-strong bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1";

export const MENU_ITEM_CLASS =
  "relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-list-active focus:text-list-active-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
