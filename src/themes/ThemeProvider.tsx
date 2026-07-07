import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettingSync } from "@/lib/settingSync";
import { applyTheme, readStoredThemeId, storeThemeId } from "./apply";
import { ThemeContext } from "./context";
import { getTheme } from "./themes";

const THEME_SYNC_KEY = "appearance.theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(() => getTheme(readStoredThemeId()));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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
