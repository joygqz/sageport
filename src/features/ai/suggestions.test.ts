import { describe, expect, it } from "vitest";

import {
  pickSuggestions,
  pickSuggestionsForSession,
  SUGGESTION_POOL,
} from "./suggestions";

describe("assistant suggestions", () => {
  it("keeps three prompts in every tool group", () => {
    expect(SUGGESTION_POOL).toHaveLength(7);
    expect(SUGGESTION_POOL.every((group) => group.keys.length === 3)).toBe(
      true,
    );
  });

  it("picks three prompts from different tool groups", () => {
    const values = [0.12, 0.73, 0.31, 0.88, 0.45, 0.67, 0.22, 0.91];
    let index = 0;
    const suggestions = pickSuggestions(
      SUGGESTION_POOL.map(({ group }) => group),
      () => values[index++ % values.length],
    );

    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions.map(({ group }) => group))).toHaveLength(3);
    expect(
      suggestions.every(({ group, key }) =>
        SUGGESTION_POOL.find((item) => item.group === group)?.keys.includes(
          key as never,
        ),
      ),
    ).toBe(true);
  });

  it("reuses enabled groups without repeating prompts when fewer than three are enabled", () => {
    const suggestions = pickSuggestions(["core"], () => 0);

    expect(suggestions).toHaveLength(3);
    expect(suggestions.every(({ group }) => group === "core")).toBe(true);
    expect(new Set(suggestions.map(({ key }) => key))).toHaveLength(3);
  });

  it("keeps suggestions stable within a session", () => {
    const groups = SUGGESTION_POOL.map(({ group }) => group);

    expect(pickSuggestionsForSession("session-1", groups)).toEqual(
      pickSuggestionsForSession("session-1", groups),
    );
  });
});
