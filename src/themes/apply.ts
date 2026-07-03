import type { ThemeColors, ThemeDefinition } from "./types";

/**
 * DOM plumbing for the theme system. The chosen theme id is persisted in
 * localStorage together with two bootstrap hints (background color and
 * color scheme) that index.html reads inline before the bundle loads, so a
 * window never flashes the wrong color while starting up.
 */

export const THEME_STORAGE_KEY = "sageport.theme";
const BOOTSTRAP_BG_KEY = "sageport.theme.bg";
const BOOTSTRAP_SCHEME_KEY = "sageport.theme.scheme";

export function readStoredThemeId(): string | null {
  return localStorage.getItem(THEME_STORAGE_KEY);
}

export function storeThemeId(theme: ThemeDefinition): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  localStorage.setItem(BOOTSTRAP_BG_KEY, theme.colors.background);
  localStorage.setItem(BOOTSTRAP_SCHEME_KEY, theme.appearance);
}

/** camelCase token name -> `--kebab-case` CSS custom property. */
function cssVarName(token: string): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Write every token of a theme onto `:root`. Also toggles the `.dark` class
 * (some utilities key off it) and `color-scheme` so native widgets —
 * scrollbars, form controls, context menus — match the theme's appearance.
 */
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

/**
 * Disable all transitions/animations until the frame containing the theme
 * swap has been painted, so every surface repaints together instead of a
 * mix of instant and animated changes. Double rAF guarantees at least one
 * full painted frame with transitions off (a timeout is not reliable:
 * dependent re-renders such as the xterm palette sync may commit slightly
 * after the token writes).
 */
let suppressor: HTMLStyleElement | null = null;

function suppressTransitionsForFrame(): void {
  if (!suppressor) {
    suppressor = document.createElement("style");
    suppressor.appendChild(
      document.createTextNode(
        "*,*::before,*::after{transition:none!important;animation:none!important}",
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
