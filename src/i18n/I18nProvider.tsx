import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

import { LOCALE_EVENT } from "@/lib/windows";
import { detectLocale, LOCALE_STORAGE_KEY, type Locale } from "./config";
import { I18nContext } from "./i18n-context";
import { translate } from "./translate";

/**
 * Provides the active locale and a `t()` translator. Mirrors the theme
 * provider: the choice is persisted to localStorage and broadcast over a Tauri
 * event so every window switches language in lockstep.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  // Reflect the language onto <html lang> for accessibility and CSS hooks.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Keep every window's language in sync.
  useEffect(() => {
    const unlisten = listen<Locale>(LOCALE_EVENT, (e) => {
      setLocaleState(e.payload);
      localStorage.setItem(LOCALE_STORAGE_KEY, e.payload);
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    void emit(LOCALE_EVENT, next);
  }, []);

  const t = useCallback(
    (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate(locale, key, params),
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
