import { DEFAULT_LOCALE, type Locale } from "./config";
import { en, type Dictionary } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
};

export type TKey = LeafPaths<Dictionary>;

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

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

export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  return interpolate(resolve(dict, key), params);
}
