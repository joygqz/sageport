import type { ITheme } from "@xterm/xterm";

import type { ThemeDefinition } from "@/themes";

export function xtermTheme(theme: ThemeDefinition): ITheme {
  return {
    ...theme.terminal,
    cursorAccent: theme.terminal.background,
  };
}
