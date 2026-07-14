import * as React from "react";

import { cn } from "@/lib/utils";
import { CONTROL_BASE_CLASS } from "./styles";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          CONTROL_BASE_CLASS,
          "flex min-h-20 px-3 py-2 text-sm",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
