import * as React from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

const MODIFIER_LABELS: Record<string, string> = IS_MACOS
  ? { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" }
  : { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };

interface KbdProps {
  keys: string[];

  className?: string;
}

export function Kbd({ keys, className }: KbdProps) {
  return (
    <kbd className="inline-flex items-center gap-1 font-sans">
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          {i > 0 && !IS_MACOS && (
            <span className="text-2xs text-muted-foreground">+</span>
          )}
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded border border-input bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground",
              className,
            )}
          >
            {MODIFIER_LABELS[key] ?? key}
          </span>
        </React.Fragment>
      ))}
    </kbd>
  );
}
