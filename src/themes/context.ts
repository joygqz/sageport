import { createContext } from "react";

import type { ThemeDefinition, ThemeMode, ThemePreference } from "./types";

export interface ThemeContextValue {
  theme: ThemeDefinition;
  preference: ThemePreference;
  setTheme: (id: string) => void;
  setFamily: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
