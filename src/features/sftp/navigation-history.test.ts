import { describe, expect, it } from "vitest";

import {
  NAVIGATION_HISTORY_LIMIT,
  pushNavigationHistory,
} from "./navigation-history";

describe("pushNavigationHistory", () => {
  it("appends new locations and ignores the current location", () => {
    const first = pushNavigationHistory(
      { history: [], historyIndex: -1 },
      "/home",
    );
    const second = pushNavigationHistory(first, "/home/docs");

    expect(second).toEqual({
      history: ["/home", "/home/docs"],
      historyIndex: 1,
    });
    expect(pushNavigationHistory(second, "/home/docs")).toBe(second);
  });

  it("discards the forward branch after navigating back", () => {
    const next = pushNavigationHistory(
      {
        history: ["/home", "/home/docs", "/home/photos"],
        historyIndex: 0,
      },
      "/tmp",
    );

    expect(next).toEqual({
      history: ["/home", "/tmp"],
      historyIndex: 1,
    });
  });

  it("keeps only the most recent locations", () => {
    let current = { history: [] as string[], historyIndex: -1 };
    for (let index = 0; index <= NAVIGATION_HISTORY_LIMIT; index += 1) {
      current = pushNavigationHistory(current, `/path/${index}`);
    }

    expect(current.history).toHaveLength(NAVIGATION_HISTORY_LIMIT);
    expect(current.history[0]).toBe("/path/1");
    expect(current.history.at(-1)).toBe(`/path/${NAVIGATION_HISTORY_LIMIT}`);
    expect(current.historyIndex).toBe(NAVIGATION_HISTORY_LIMIT - 1);
  });
});
