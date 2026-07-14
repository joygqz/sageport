import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring/35 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary:
          "border-input bg-secondary text-secondary-foreground hover:bg-accent active:bg-accent",
        outline:
          "border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        ghost:
          "border-transparent hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "border-transparent text-link underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-[var(--control-height-sm)] px-3 text-xs",
        md: "h-[var(--control-height)] px-4",
        lg: "h-[var(--control-height-lg)] px-6",
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
