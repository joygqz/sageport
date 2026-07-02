import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "@/theme/theme-context";

/**
 * xterm requires concrete colors (it can't read our oklch CSS variables), so we
 * keep hand-tuned ANSI palettes that visually match the app's light/dark themes.
 *
 * `background`/`foreground` MUST byte-match --terminal-background /
 * --terminal-foreground in styles/globals.css: the gutter around the canvas is
 * painted with the CSS variable, and any drift shows up as a visible frame.
 */
const dark: ITheme = {
  background: "#0d1117",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "#1f3a5f",
  black: "#21262d",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#6fd3d3",
  white: "#c5cad3",
  brightBlack: "#4b515c",
  brightRed: "#ff8b8d",
  brightGreen: "#9beecf",
  brightYellow: "#f3d28c",
  brightBlue: "#8fc8ff",
  brightMagenta: "#d9bcff",
  brightCyan: "#8fe5e5",
  brightWhite: "#f1f4f8",
};

const light: ITheme = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#0969da",
  cursorAccent: "#ffffff",
  selectionBackground: "#b6e3ff",
  black: "#1f2328",
  red: "#d1242f",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1f9a9a",
  white: "#dfe3ea",
  brightBlack: "#6b7280",
  brightRed: "#e2575a",
  brightGreen: "#27b18b",
  brightYellow: "#c98f24",
  brightBlue: "#3b7ae0",
  brightMagenta: "#a066e6",
  brightCyan: "#27b1b1",
  brightWhite: "#11151c",
};

export function terminalTheme(resolved: ResolvedTheme): ITheme {
  return resolved === "dark" ? dark : light;
}
