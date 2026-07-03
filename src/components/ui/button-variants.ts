import { cva } from "class-variance-authority";

/**
 * GitHub's `.btn` language: every non-ghost variant carries a 1px border
 * (transparent for solid fills, --border for the neutral default button).
 * Hover/active states use solid tokens rather than opacity-diluted ones —
 * a flat, near-invisible hover was a defect this design fixed, not a look
 * to preserve.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        outline:
          "border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost:
          "border-transparent hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "border-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);
