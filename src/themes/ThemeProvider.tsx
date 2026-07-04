import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import { applyTheme, readStoredThemeId, storeThemeId } from "./apply";
import { ThemeContext } from "./context";
import { getTheme } from "./themes";

/** Settings-table key the chosen theme rides along with vault sync under. */
const THEME_SYNC_KEY = "appearance.theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(() => getTheme(readStoredThemeId()));

  // index.html only paints the background before load; the full token set
  // is applied here on mount and again whenever the theme changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Reconciles with a theme choice merged in from another device (on
  // mount, and whenever a sync connect/push/restore invalidates queries).
  const pushTheme = useSettingSync(THEME_SYNC_KEY, theme.id, (remoteId) => {
    const next = getTheme(remoteId);
    setThemeState(next);
    storeThemeId(next);
  });

  const setTheme = useCallback(
    (id: string) => {
      const next = getTheme(id);
      setThemeState(next);
      storeThemeId(next);
      pushTheme(next.id);
    },
    [pushTheme],
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
