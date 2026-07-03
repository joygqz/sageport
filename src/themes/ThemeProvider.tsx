import { useCallback, useEffect, useMemo, useState } from "react";

import { applyTheme, readStoredThemeId, storeThemeId } from "./apply";
import { ThemeContext } from "./context";
import { getTheme } from "./themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState(() => getTheme(readStoredThemeId()));

  // index.html only paints the background before load; the full token set
  // is applied here on mount and again whenever the theme changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: string) => {
    const next = getTheme(id);
    setThemeState(next);
    storeThemeId(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
