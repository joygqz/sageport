import { DEFAULT_LOCALE, type Locale } from "./config";
import type { Dictionary } from "./locales/en";

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import("./locales/en").then((module) => module.en),
  "zh-CN": () => import("./locales/zh-CN").then((module) => module.zhCN),
};

const dictionaries = new Map<Locale, Dictionary>();
const pending = new Map<Locale, Promise<void>>();

export function loadLocale(locale: Locale): Promise<void> {
  if (dictionaries.has(locale)) return Promise.resolve();

  let task = pending.get(locale);
  if (!task) {
    task = loaders[locale]()
      .then((dictionary) => {
        dictionaries.set(locale, dictionary);
      })
      .catch((error) => {
        pending.delete(locale);
        throw error;
      });
    pending.set(locale, task);
  }
  return task;
}

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
  const dict =
    dictionaries.get(locale) ??
    dictionaries.get(DEFAULT_LOCALE) ??
    dictionaries.values().next().value;
  if (!dict) return key;
  return interpolate(resolve(dict, key), params);
}
