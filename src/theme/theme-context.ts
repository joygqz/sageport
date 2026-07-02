import { createContext } from "react";

import type { ThemeAccent } from "./accent";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  /** The user's chosen mode, including "system". */
  mode: ThemeMode;
  /** The concrete theme currently applied to the DOM. */
  resolved: ResolvedTheme;
  /** The user's chosen accent palette. */
  accent: ThemeAccent;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
