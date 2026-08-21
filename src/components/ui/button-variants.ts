import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "border-primary bg-primary text-primary-foreground hover:border-primary/90 hover:bg-primary/90 active:bg-primary/80",
        secondary:
          "border-border-strong bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        outline:
          "border-border-strong bg-surface-raised text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost:
          "border-transparent hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        link: "border-transparent text-link underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-[var(--control-height-sm)] px-2.5 text-xs",
        md: "h-[var(--control-height)] px-3.5",
        lg: "h-[var(--control-height-lg)] px-5",
        icon: "size-[var(--control-height)]",
      },
    },
    compoundVariants: [
      {
        variant: "ghost",
        size: "icon",
        class: "text-muted-foreground",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);
