import * as React from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Platform-aware display names for modifier tokens used in shortcuts. */
const MODIFIER_LABELS: Record<string, string> = IS_MACOS
  ? { mod: "⌘", shift: "⇧", alt: "⌥" }
  : { mod: "Ctrl", shift: "Shift", alt: "Alt" };

function formatShortcut(keys: string[]): string[] {
  return keys.map((k) => MODIFIER_LABELS[k] ?? k);
}

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Shortcut tokens, e.g. ["mod", "P"]. Rendered platform-aware. */
  keys?: string[];
}

export function Kbd({ className, keys, children, ...props }: KbdProps) {
  const parts = keys ? formatShortcut(keys) : null;

  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center gap-x-0.5 rounded border border-border bg-muted px-1.5 font-mono text-2xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    >
      {parts
        ? parts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && !IS_MACOS && "+"}
              <span>{part}</span>
            </React.Fragment>
          ))
        : children}
    </kbd>
  );
}
