import type { ResolvedTheme, ThemeMode } from "./theme-context";

/**
 * DOM-level theme plumbing shared by the React provider. The initial class is
 * applied even earlier by the inline bootstrap in index.html (to prevent a
 * load flash); this module keeps <html> in sync afterwards and guarantees the
 * light/dark swap is uniform.
 *
 * NOTE: STORAGE_KEY is duplicated literally in index.html's bootstrap script.
 */
export const THEME_STORAGE_KEY = "sageport.theme";

export function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

export function storeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply the resolved theme to <html>. Transitions are suppressed for the
 * duration of the swap so every surface — backgrounds, borders, text, and
 * components that happen to carry `transition-colors` — repaints together
 * instead of a jarring mix of instant and animated changes.
 */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  const restore = suppressTransitions();
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  restore();
}

function suppressTransitions(): () => void {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{transition:none!important;animation:none!important}",
    ),
  );
  document.head.appendChild(style);

  return () => {
    // Force the browser to compute styles with transitions still disabled…
    void window.getComputedStyle(document.body).opacity;
    // …then re-enable them on the next tick for normal interactions.
    setTimeout(() => style.remove(), 1);
  };
}
