import { useCallback, useEffect, useMemo, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

import { THEME_ACCENT_EVENT, THEME_EVENT } from "@/lib/windows";
import { applyAccent, type ThemeAccent } from "./accent";
import {
  applyResolvedTheme,
  getSystemTheme,
  readStoredAccent,
  readStoredMode,
  storeAccent,
  storeMode,
} from "./dom";
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-context";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [accent, setAccentState] = useState<ThemeAccent>(readStoredAccent);
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

  // Reflect the accent palette onto <html> whenever it — or the resolved
  // light/dark theme it's blended with — changes.
  useEffect(() => {
    applyAccent(accent, resolved);
  }, [accent, resolved]);

  // Keep every window's mode and accent in sync.
  useEffect(() => {
    const unlistenMode = listen<ThemeMode>(THEME_EVENT, (e) => {
      setModeState(e.payload);
      storeMode(e.payload);
    });
    const unlistenAccent = listen<ThemeAccent>(THEME_ACCENT_EVENT, (e) => {
      setAccentState(e.payload);
      storeAccent(e.payload);
    });
    return () => {
      void unlistenMode.then((un) => un());
      void unlistenAccent.then((un) => un());
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    storeMode(next);
    void emit(THEME_EVENT, next);
  }, []);

  const setAccent = useCallback((next: ThemeAccent) => {
    setAccentState(next);
    storeAccent(next);
    void emit(THEME_ACCENT_EVENT, next);
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, accent, setMode, setAccent }),
    [mode, resolved, accent, setMode, setAccent],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
