import * as React from "react";

import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";

const MODIFIER_LABELS: Record<string, string> = IS_MACOS
  ? { mod: "⌘", ctrl: "⌃", shift: "⇧", alt: "⌥" }
  : { mod: "Ctrl", ctrl: "Ctrl", shift: "Shift", alt: "Alt" };

const KEY_LABELS: Record<string, string> = {
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  backspace: "Backspace",
  delete: "Del",
  end: "End",
  enter: "Enter",
  home: "Home",
  insert: "Ins",
  pagedown: "PgDn",
  pageup: "PgUp",
  space: "Space",
  tab: "Tab",
};

function keyLabel(key: string): string {
  if (MODIFIER_LABELS[key]) return MODIFIER_LABELS[key];
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (/^[a-z]$|^f(?:[1-9]|1\d|2[0-4])$/.test(key)) {
    return key.toUpperCase();
  }
  return key;
}

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
            {keyLabel(key)}
          </span>
        </React.Fragment>
      ))}
    </kbd>
  );
}
