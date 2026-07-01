import { createContext } from "react";

import type { Locale } from "./config";
import type { TFunction } from "./translate";

export interface I18nContextValue {
  /** The active locale tag. */
  locale: Locale;
  /** Switch the locale; broadcast to every window. */
  setLocale: (locale: Locale) => void;
  /** Translate a typed key, with optional `{placeholder}` interpolation. */
  t: TFunction;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
