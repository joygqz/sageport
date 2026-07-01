import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

import { THEME_EVENT } from "@/lib/windows";
import {
  applyResolvedTheme,
  getSystemTheme,
  readStoredMode,
  storeMode,
} from "./dom";
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-context";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemTheme, setSystemTheme] =
    useState<ResolvedTheme>(getSystemTheme);

  // Track OS-level preference changes while in "system" mode.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = mode === "system" ? systemTheme : mode;

  // Reflect the resolved theme onto <html>. The inline bootstrap in index.html
  // already painted the correct theme before load; this keeps it in sync and
  // performs an instant, uniform swap whenever it changes.
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // Keep every window's theme in sync.
  useEffect(() => {
    const unlisten = listen<ThemeMode>(THEME_EVENT, (e) => {
      setModeState(e.payload);
      storeMode(e.payload);
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    storeMode(next);
    void emit(THEME_EVENT, next);
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
