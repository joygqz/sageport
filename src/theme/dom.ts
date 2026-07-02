import {
  applyAccent,
  DEFAULT_ACCENT,
  isThemeAccent,
  type ThemeAccent,
} from "./accent";
import type { ResolvedTheme, ThemeMode } from "./theme-context";

/**
 * DOM-level theme plumbing shared by the React provider. The initial class is
 * applied even earlier by the inline bootstrap in index.html (to prevent a
 * load flash); this module keeps <html> in sync afterwards and guarantees the
 * light/dark swap is uniform.
 *
 * STORAGE_KEY is duplicated literally in index.html's bootstrap script.
 */
export const THEME_STORAGE_KEY = "sageport.theme";
export const ACCENT_STORAGE_KEY = "sageport.accent";

export function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

export function storeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function readStoredAccent(): ThemeAccent {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  return isThemeAccent(stored) ? stored : DEFAULT_ACCENT;
}

export function storeAccent(accent: ThemeAccent): void {
  localStorage.setItem(ACCENT_STORAGE_KEY, accent);
}

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply the resolved theme *and* accent to <html> as one atomic swap.
 *
 * Both are applied inside a single transition-suppression window so every
 * surface — backgrounds, borders, text, and components that happen to carry
 * `transition-colors` — repaints together instead of a jarring mix of
 * instant and animated changes. (Applying them separately, or letting the
 * accent change animate, is exactly what produced the "some elements fade,
 * some snap" artifact when switching theme or accent.)
 */
export function applyTheme(resolved: ResolvedTheme, accent: ThemeAccent): void {
  const root = document.documentElement;
  suppressTransitionsForFrame();
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  applyAccent(accent, resolved);
}

/**
 * Disable all transitions/animations until the frame that contains the theme
 * swap has actually been painted. A timeout is not reliable here: React may
 * commit dependent re-renders (xterm palette sync, inline colors) slightly
 * after the class toggle, and re-enabling transitions in between splits the
 * swap into animated and non-animated halves. Double rAF guarantees at least
 * one full painted frame with transitions off.
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
