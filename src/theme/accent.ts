import type { ResolvedTheme } from "./theme-context";

/**
 * Accent palette registry. "mono" is the professional black/white default
 * baked directly into globals.css — selecting it means removing overrides.
 * Every other accent overrides the same seven tokens as inline styles on
 * <html> (see dom.ts#applyAccent), so component code never needs to know
 * which accent is active; it only ever reads the semantic Tailwind colors.
 */
export const ACCENTS = [
  "mono",
  "indigo",
  "teal",
  "forest",
  "amber",
] as const;

export type ThemeAccent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: ThemeAccent = "mono";

export interface AccentTokens {
  primary: string;
  primaryForeground: string;
  accent: string;
  accentForeground: string;
  ring: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
}

/** Swatch color used to represent each accent in the settings picker. */
export const ACCENT_SWATCH: Record<ThemeAccent, string> = {
  mono: "oklch(0.2 0 0)",
  indigo: "oklch(0.62 0.135 265)",
  teal: "oklch(0.62 0.1 195)",
  forest: "oklch(0.62 0.11 150)",
  amber: "oklch(0.62 0.11 75)",
};

/**
 * Overrides for every accent except "mono", whose values already live as the
 * defaults in globals.css. Each palette mirrors the same lightness curve per
 * theme (light/dark) established there, only varying hue and chroma.
 */
export const ACCENT_OVERRIDES: Record<
  Exclude<ThemeAccent, "mono">,
  Record<ResolvedTheme, AccentTokens>
> = {
  indigo: {
    light: {
      primary: "oklch(0.62 0.135 265)",
      primaryForeground: "oklch(0.99 0.01 265)",
      accent: "oklch(0.95 0.021 265)",
      accentForeground: "oklch(0.3 0.052 265)",
      ring: "oklch(0.62 0.135 265)",
      sidebarAccent: "oklch(0.91 0.026 265)",
      sidebarAccentForeground: "oklch(0.28 0.052 265)",
    },
    dark: {
      primary: "oklch(0.7 0.135 265)",
      primaryForeground: "oklch(0.18 0.031 265)",
      accent: "oklch(0.32 0.031 265)",
      accentForeground: "oklch(0.9 0.042 265)",
      ring: "oklch(0.7 0.135 265)",
      sidebarAccent: "oklch(0.32 0.031 265)",
      sidebarAccentForeground: "oklch(0.9 0.042 265)",
    },
  },
  teal: {
    light: {
      primary: "oklch(0.62 0.1 195)",
      primaryForeground: "oklch(0.99 0.008 195)",
      accent: "oklch(0.95 0.015 195)",
      accentForeground: "oklch(0.3 0.039 195)",
      ring: "oklch(0.62 0.1 195)",
      sidebarAccent: "oklch(0.91 0.019 195)",
      sidebarAccentForeground: "oklch(0.28 0.039 195)",
    },
    dark: {
      primary: "oklch(0.7 0.1 195)",
      primaryForeground: "oklch(0.18 0.023 195)",
      accent: "oklch(0.32 0.023 195)",
      accentForeground: "oklch(0.9 0.031 195)",
      ring: "oklch(0.7 0.1 195)",
      sidebarAccent: "oklch(0.32 0.023 195)",
      sidebarAccentForeground: "oklch(0.9 0.031 195)",
    },
  },
  forest: {
    light: {
      primary: "oklch(0.62 0.11 150)",
      primaryForeground: "oklch(0.99 0.008 150)",
      accent: "oklch(0.95 0.017 150)",
      accentForeground: "oklch(0.3 0.042 150)",
      ring: "oklch(0.62 0.11 150)",
      sidebarAccent: "oklch(0.91 0.021 150)",
      sidebarAccentForeground: "oklch(0.28 0.042 150)",
    },
    dark: {
      primary: "oklch(0.7 0.11 150)",
      primaryForeground: "oklch(0.18 0.025 150)",
      accent: "oklch(0.32 0.025 150)",
      accentForeground: "oklch(0.9 0.034 150)",
      ring: "oklch(0.7 0.11 150)",
      sidebarAccent: "oklch(0.32 0.025 150)",
      sidebarAccentForeground: "oklch(0.9 0.034 150)",
    },
  },
  amber: {
    light: {
      primary: "oklch(0.62 0.11 75)",
      primaryForeground: "oklch(0.99 0.008 75)",
      accent: "oklch(0.95 0.017 75)",
      accentForeground: "oklch(0.3 0.042 75)",
      ring: "oklch(0.62 0.11 75)",
      sidebarAccent: "oklch(0.91 0.021 75)",
      sidebarAccentForeground: "oklch(0.28 0.042 75)",
    },
    dark: {
      primary: "oklch(0.7 0.11 75)",
      primaryForeground: "oklch(0.18 0.025 75)",
      accent: "oklch(0.32 0.025 75)",
      accentForeground: "oklch(0.9 0.034 75)",
      ring: "oklch(0.7 0.11 75)",
      sidebarAccent: "oklch(0.32 0.025 75)",
      sidebarAccentForeground: "oklch(0.9 0.034 75)",
    },
  },
};

export function isThemeAccent(value: unknown): value is ThemeAccent {
  return (
    typeof value === "string" && (ACCENTS as readonly string[]).includes(value)
  );
}

/** Maps AccentTokens' camelCase keys onto the CSS custom property names. */
const ACCENT_CSS_VARS: Record<keyof AccentTokens, string> = {
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  ring: "--ring",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
};

/**
 * Applies an accent to <html>. "mono" clears any inline overrides so the
 * neutral defaults in globals.css take effect; every other accent sets the
 * seven tokens as inline styles, which win over the class-based defaults.
 */
export function applyAccent(accent: ThemeAccent, resolved: ResolvedTheme): void {
  const root = document.documentElement;
  const tokens = accent === "mono" ? null : ACCENT_OVERRIDES[accent][resolved];

  for (const key of Object.keys(ACCENT_CSS_VARS) as (keyof AccentTokens)[]) {
    const cssVar = ACCENT_CSS_VARS[key];
    if (tokens) {
      root.style.setProperty(cssVar, tokens[key]);
    } else {
      root.style.removeProperty(cssVar);
    }
  }
}
