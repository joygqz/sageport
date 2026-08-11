import { create } from "zustand";
import { persist } from "zustand/middleware";

import { applyTerminalHighlightRules } from "./sessions";
import {
  DEFAULT_HIGHLIGHT_RULES,
  normalizeHighlightRules,
  type HighlightRule,
} from "./highlight-rules";

interface HighlightState {
  rules: HighlightRule[];
  replaceRules: (rules: HighlightRule[]) => void;
}

export const useHighlightStore = create<HighlightState>()(
  persist(
    (set) => ({
      rules: DEFAULT_HIGHLIGHT_RULES,
      replaceRules: (rules) => {
        const normalized = normalizeHighlightRules(rules);
        set({ rules: normalized });
        applyTerminalHighlightRules(normalized);
      },
    }),
    {
      name: "sageport.highlightRules",
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted as Partial<HighlightState> | undefined;
        if (version === 0 && (!state?.rules || state.rules.length === 0)) {
          return { ...state, rules: DEFAULT_HIGHLIGHT_RULES };
        }
        if (
          version < 2 &&
          state?.rules?.length === 4 &&
          state.rules.every((rule) =>
            [
              "example-error",
              "example-warn",
              "example-failed",
              "example-success",
            ].includes(rule.id),
          )
        ) {
          return { ...state, rules: DEFAULT_HIGHLIGHT_RULES };
        }
        if (
          version < 3 &&
          state?.rules?.length === 6 &&
          state.rules.every((rule) =>
            [
              "example-debug",
              "example-verbose",
              "example-warn",
              "example-error",
              "example-info",
              "example-note",
            ].includes(rule.id),
          )
        ) {
          return { ...state, rules: DEFAULT_HIGHLIGHT_RULES };
        }
        return state;
      },
      merge: (persisted, current) => {
        const stored = (persisted as Partial<HighlightState> | undefined)
          ?.rules;
        return {
          ...current,
          rules:
            stored === undefined
              ? current.rules
              : normalizeHighlightRules(stored),
        };
      },
    },
  ),
);
