import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import { errorMessage, toast } from "@/lib/toast";
import {
  detectLocale,
  isLocale,
  LOCALE_CHANGE_EVENT,
  LOCALE_STORAGE_KEY,
  type Locale,
} from "./config";
import { I18nContext } from "./i18n-context";
import { translate } from "./translate";

const LOCALE_SYNC_KEY = "general.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<Locale>).detail;
      if (isLocale(next)) setLocaleState(next);
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, update);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, update);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const pushLocale = useSettingSync(
    LOCALE_SYNC_KEY,
    locale,
    (remote) => {
      if (!isLocale(remote)) return;
      setLocaleState(remote);
      localStorage.setItem(LOCALE_STORAGE_KEY, remote);
    },
    {
      onLoadError: (error) =>
        toast.error(
          translate(locale, "settings.persistence.loadError"),
          errorMessage(error),
        ),
      onSaveError: (error) =>
        toast.error(
          translate(locale, "settings.persistence.saveError"),
          errorMessage(error),
        ),
    },
  );

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
