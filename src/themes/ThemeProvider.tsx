import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import {
  applyTheme,
  parseThemePreference,
  readStoredThemePreference,
  serializeThemePreference,
  storeThemePreference,
  THEME_PREFERENCE_EVENT,
} from "./apply";
import { ThemeContext } from "./context";
import {
  getTheme,
  getThemeFamily,
  preferenceFromThemeId,
  resolveTheme,
} from "./themes";
import type { ThemeAppearance, ThemeMode, ThemePreference } from "./types";

const THEME_SYNC_KEY = "general.theme";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function systemAppearance(): ThemeAppearance {
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [preference, setPreference] = useState(readStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState(systemAppearance);
  const theme = useMemo(
    () => resolveTheme(preference, systemTheme),
    [preference, systemTheme],
  );

  useEffect(() => {
    const update = (event: Event) => {
      setPreference((event as CustomEvent<ThemePreference>).detail);
    };
    window.addEventListener(THEME_PREFERENCE_EVENT, update);
    return () => window.removeEventListener(THEME_PREFERENCE_EVENT, update);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(DARK_SCHEME_QUERY);
    const update = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    storeThemePreference(preference, theme);
  }, [preference, theme]);

  const serializedPreference = serializeThemePreference(preference);
  const pushTheme = useSettingSync(
    THEME_SYNC_KEY,
    serializedPreference,
    (remoteValue) => setPreference(parseThemePreference(remoteValue)),
    {
      onLoadError: (error) =>
        toast.error(t("settings.persistence.loadError"), errorMessage(error)),
      onSaveError: (error) =>
        toast.error(t("settings.persistence.saveError"), errorMessage(error)),
    },
  );

  const updatePreference = useCallback(
    (next: ThemePreference) => {
      setPreference(next);
      pushTheme(serializeThemePreference(next));
    },
    [pushTheme],
  );

  const setTheme = useCallback(
    (id: string) => updatePreference(preferenceFromThemeId(getTheme(id).id)),
    [updatePreference],
  );

  const setFamily = useCallback(
    (id: string) =>
      updatePreference({
        familyId: getThemeFamily(id).id,
        mode: preference.mode,
      }),
    [preference.mode, updatePreference],
  );

  const setMode = useCallback(
    (mode: ThemeMode) =>
      updatePreference({ familyId: preference.familyId, mode }),
    [preference.familyId, updatePreference],
  );

  const value = useMemo(
    () => ({
      theme,
      preference,
      setPreference: updatePreference,
      setTheme,
      setFamily,
      setMode,
    }),
    [preference, setFamily, setMode, setTheme, theme, updatePreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
