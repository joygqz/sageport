import { createContext } from "react";

import type { ThemeDefinition } from "./types";

export interface ThemeContextValue {
  /** The theme currently applied to the DOM. */
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
