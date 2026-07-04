import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import { detectLocale, isLocale, LOCALE_STORAGE_KEY, type Locale } from "./config";
import { I18nContext } from "./i18n-context";
import { translate } from "./translate";

/** Settings-table key the chosen locale rides along with vault sync under. */
const LOCALE_SYNC_KEY = "appearance.locale";

/** Provides the active locale and a `t()` translator, persisted to localStorage. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // Reflect the language onto <html lang> for accessibility and CSS hooks.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Reconciles with a locale choice merged in from another device (on
  // mount, and whenever a sync connect/push/restore invalidates queries).
  const pushLocale = useSettingSync(LOCALE_SYNC_KEY, locale, (remote) => {
    if (!isLocale(remote)) return;
    setLocaleState(remote);
    localStorage.setItem(LOCALE_STORAGE_KEY, remote);
  });

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
      pushLocale(next);
    },
    [pushLocale],
  );

  const t = useCallback(
    (
      key: Parameters<typeof translate>[1],
      params?: Parameters<typeof translate>[2],
    ) => translate(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
