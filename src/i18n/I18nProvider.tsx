import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import {
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./config";
import { I18nContext } from "./i18n-context";
import { translate } from "./translate";

const LOCALE_SYNC_KEY = "appearance.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

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
