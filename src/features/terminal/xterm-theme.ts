import type { ITheme } from "@xterm/xterm";

import type { ThemeDefinition } from "@/themes";

/**
 * Build xterm's color config from the app theme. xterm cannot read CSS
 * variables, so it receives the same TypeScript palette that produced them,
 * which keeps the canvas and the surrounding gutter pixel-identical.
 */
export function xtermTheme(theme: ThemeDefinition): ITheme {
  return {
    ...theme.terminal,
    cursorAccent: theme.terminal.background,
  };
}
