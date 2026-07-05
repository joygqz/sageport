import * as React from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Platform-aware display names for modifier tokens used in shortcuts. */
const MODIFIER_LABELS: Record<string, string> = IS_MACOS
  ? { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" }
  : { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };

interface KbdProps {
  /** Shortcut tokens, e.g. ["mod", "P"]. Rendered platform-aware. */
  keys: string[];
  /** Merged into each keycap, e.g. to shrink them in dense chrome. */
  className?: string;
}

/**
 * Keyboard shortcut, VSCode-style: one keycap per key. macOS shows bare
 * symbol caps (⇧ ⌘ P); other platforms join caps with "+" (Ctrl+Shift+P).
 */
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
              "flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground",
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
