import {
  DEFAULT_THEME_FAMILY_ID,
  DEFAULT_THEME_MODE,
  getThemeFamily,
  preferenceFromThemeId,
} from "./themes";
import type {
  ThemeColors,
  ThemeDefinition,
  ThemeMode,
  ThemePreference,
} from "./types";

const THEME_STORAGE_KEY = "sageport.theme";
const BOOTSTRAP_BG_KEY = "sageport.theme.bg";
const BOOTSTRAP_SCHEME_KEY = "sageport.theme.scheme";

export function parseThemePreference(value: string | null): ThemePreference {
  if (!value) {
    return {
      familyId: DEFAULT_THEME_FAMILY_ID,
      mode: DEFAULT_THEME_MODE,
    };
  }

  const [familyId, mode] = value.split(":");
  if (
    familyId &&
    getThemeFamily(familyId).id === familyId &&
    isThemeMode(mode)
  ) {
    return { familyId, mode };
  }

  return preferenceFromThemeId(value);
}

export function readStoredThemePreference(): ThemePreference {
  return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
}

export function serializeThemePreference(preference: ThemePreference): string {
  return `${preference.familyId}:${preference.mode}`;
}

export function storeThemePreference(
  preference: ThemePreference,
  theme: ThemeDefinition,
): void {
  localStorage.setItem(THEME_STORAGE_KEY, serializeThemePreference(preference));
  localStorage.setItem(BOOTSTRAP_BG_KEY, theme.colors.background);
  localStorage.setItem(BOOTSTRAP_SCHEME_KEY, theme.appearance);
}

function isThemeMode(value: string | undefined): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function cssVarName(token: string): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;
  suppressTransitionsForFrame();

  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(cssVarName(token as keyof ThemeColors), value);
  }
  root.style.setProperty("--terminal-background", theme.terminal.background);
  root.style.setProperty("--terminal-foreground", theme.terminal.foreground);

  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = theme.id;
}

let suppressor: HTMLStyleElement | null = null;

function suppressTransitionsForFrame(): void {
  if (!suppressor) {
    suppressor = document.createElement("style");
    suppressor.appendChild(
      document.createTextNode(
        "*,*::before,*::after{transition:none!important}",
      ),
    );
    document.head.appendChild(suppressor);
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      suppressor?.remove();
      suppressor = null;
    });
  });
}
