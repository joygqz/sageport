/**
 * A theme is one complete, named look: every semantic UI token plus the
 * terminal's ANSI palette, defined together in TypeScript. The provider
 * writes the tokens onto `:root` as CSS custom properties and hands the
 * terminal palette to xterm, so both surfaces always come from the same
 * source and can never drift apart.
 */

export type ThemeAppearance = "light" | "dark";

/** Semantic UI tokens. Names mirror the CSS custom properties 1:1. */
export interface ThemeColors {
  /** Content surfaces: editor area, forms, dialogs body. */
  background: string;
  foreground: string;

  /** Chrome ring: title bar, activity bar, side bar, panel, status bar. */
  surface: string;
  surfaceForeground: string;

  /** Floating surfaces: menus, popovers, toasts. */
  popover: string;
  popoverForeground: string;

  /** Raised in-page surfaces: cards, list rows on hover panels. */
  card: string;
  cardForeground: string;

  /** The single pervasive interactive color: links, focus, primary button. */
  primary: string;
  primaryForeground: string;

  secondary: string;
  secondaryForeground: string;

  muted: string;
  mutedForeground: string;

  /** Neutral hover wash for buttons and menu items. */
  accent: string;
  accentForeground: string;

  destructive: string;
  destructiveForeground: string;

  success: string;
  warning: string;
  info: string;

  border: string;
  input: string;
  ring: string;

  /** List navigation (host tree, palette results): hover and selected row. */
  listHover: string;
  listActive: string;
  listActiveForeground: string;
}

/** Concrete colors for xterm. `background` doubles as the editor gutter. */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeDefinition {
  /** Stable id persisted in settings; never rename once shipped. */
  id: string;
  /** Display name. Theme names are proper nouns and are not translated. */
  name: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  terminal: TerminalPalette;
}
