import { createContext } from "react";

import type { Locale } from "./config";
import type { TFunction } from "./translate";

export interface I18nContextValue {
  locale: Locale;

  setLocale: (locale: Locale) => void;

  t: TFunction;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
