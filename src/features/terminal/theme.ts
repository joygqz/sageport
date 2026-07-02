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
  background: "#16181d",
  foreground: "#dfe3ea",
  cursor: "#7fd6b6",
  cursorAccent: "#16181d",
  selectionBackground: "#2f5f50",
  black: "#22252c",
  red: "#f47174",
  green: "#7fd6b6",
  yellow: "#e6c07b",
  blue: "#6cb6ff",
  magenta: "#c8a4ff",
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
  background: "#fbfcfe",
  foreground: "#2b303b",
  cursor: "#1f9c79",
  cursorAccent: "#fbfcfe",
  selectionBackground: "#bfe6d8",
  black: "#2b303b",
  red: "#d23c3f",
  green: "#1f9c79",
  yellow: "#b07a1a",
  blue: "#2563c9",
  magenta: "#8b4ad6",
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
