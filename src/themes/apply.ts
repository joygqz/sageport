import type { ThemeColors, ThemeDefinition } from "./types";

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
