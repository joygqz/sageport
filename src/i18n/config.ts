/**
 * Locale registry. Adding a language means: append its tag here, add a
 * `LOCALE_LABELS` entry, and create a `locales/<tag>.ts` dictionary that
 * satisfies the `Dictionary` type. Everything else (typing, switching,
 * cross-window sync) flows from these declarations.
 */

export const LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Display names shown in the language picker, each written in its own script. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

/** localStorage key, mirroring the theme provider's persistence strategy. */
export const LOCALE_STORAGE_KEY = "sageport.locale";

function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Resolve the locale to start with: a previously saved choice wins, otherwise
 * we fall back to the closest match for the OS/browser language.
 */
export function detectLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("zh")) return "zh-CN";
  return DEFAULT_LOCALE;
}
