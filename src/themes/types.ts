export type ThemeAppearance = "light" | "dark";
export type ThemeMode = ThemeAppearance | "system";

export interface ThemeColors {
  background: string;
  foreground: string;

  surface: string;
  surfaceForeground: string;

  popover: string;
  popoverForeground: string;

  card: string;
  cardForeground: string;

  primary: string;
  primaryForeground: string;
  link: string;

  secondary: string;
  secondaryForeground: string;

  muted: string;
  mutedForeground: string;

  accent: string;
  accentForeground: string;

  destructive: string;
  destructiveForeground: string;
  danger: string;

  success: string;
  warning: string;
  info: string;

  border: string;
  input: string;
  ring: string;

  listHover: string;
  listActive: string;
  listActiveForeground: string;
}

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
  id: string;
  familyId: string;
  name: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  terminal: TerminalPalette;
}

export interface ThemeFamilyDefinition {
  id: string;
  name: string;
  description: string;
  themes: Record<ThemeAppearance, ThemeDefinition>;
}

export interface ThemePreference {
  familyId: string;
  mode: ThemeMode;
}
