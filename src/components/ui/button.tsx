import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "./button-variants";

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  children,
  disabled,
  type,
  ref,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      // Default to a non-submitting button so instances inside a <form> (e.g.
      // steppers or icon controls) don't accidentally submit it. Real submit
      // buttons opt in with an explicit type="submit".
      type={asChild ? type : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild && (
        <Loader2 aria-hidden="true" className="animate-spin" />
      )}
      {children}
    </Comp>
  );
}
