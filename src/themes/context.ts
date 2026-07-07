import { createContext } from "react";

import type { ThemeDefinition } from "./types";

export interface ThemeContextValue {
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
