import * as React from "react";

import { cn } from "@/lib/utils";
import { CONTROL_BASE_CLASS } from "./styles";

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
          CONTROL_BASE_CLASS,
          "flex h-[var(--control-height)] px-3 py-1 text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
