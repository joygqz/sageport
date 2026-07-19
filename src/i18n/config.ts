export const LOCALES = ["en", "zh-CN"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

export const LOCALE_STORAGE_KEY = "sageport.locale";
export const LOCALE_CHANGE_EVENT = "sageport:locale-change";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

export function detectLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;

  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("zh")) return "zh-CN";
  return DEFAULT_LOCALE;
}

export function publishLocale(locale: Locale): void {
  window.dispatchEvent(
    new CustomEvent<Locale>(LOCALE_CHANGE_EVENT, { detail: locale }),
  );
}
