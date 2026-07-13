import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-surface px-3 py-1 text-sm shadow-[inset_0_1px_1px_color-mix(in_oklch,var(--color-foreground)_4%,transparent)] transition-[border-color,box-shadow]",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
