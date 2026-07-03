import * as React from "react";

import { cn } from "@/lib/utils";

export function Kbd({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-2xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
