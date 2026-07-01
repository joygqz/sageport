import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type Dictionary } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
};

/**
 * Every dot-separated path that resolves to a string leaf in the dictionary,
 * e.g. `"settings.appearance.language"`. Derived from the English dictionary so
 * keys are checked at compile time and autocompleted in editors.
 */
export type TKey = LeafPaths<Dictionary>;

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

/** Interpolation values substituted into `{placeholder}` tokens. */
export type TParams = Record<string, string | number>;

export type TFunction = (key: TKey, params?: TParams) => string;

function resolve(dict: Dictionary, key: string): string {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof value === "string" ? value : key;
}

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, token: string) =>
    token in params ? String(params[token]) : `{${token}}`,
  );
}

/**
 * Framework-agnostic lookup so non-React call sites (window titles, helpers)
 * can translate too. Falls back to the key itself if a string is missing,
 * and to the default locale's dictionary for an unknown locale.
 */
export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  return interpolate(resolve(dict, key), params);
}
