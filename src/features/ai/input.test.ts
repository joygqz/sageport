import { describe, expect, it } from "vitest";

import { shouldSubmitPrompt } from "./input";

const enter = {
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  keyCode: 13,
};

describe("shouldSubmitPrompt", () => {
  it("submits a plain Enter key", () => {
    expect(shouldSubmitPrompt(enter, false)).toBe(true);
  });

  it("does not submit while an input method is composing", () => {
    expect(shouldSubmitPrompt({ ...enter, isComposing: true }, false)).toBe(
      false,
    );
    expect(shouldSubmitPrompt(enter, true)).toBe(false);
    expect(shouldSubmitPrompt({ ...enter, keyCode: 229 }, false)).toBe(false);
  });

  it("does not submit with Shift+Enter", () => {
    expect(shouldSubmitPrompt({ ...enter, shiftKey: true }, false)).toBe(false);
  });
});
