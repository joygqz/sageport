import { describe, expect, it } from "vitest";

import { DIALOG_CONTENT_CLASS, DIALOG_VIEWPORT_CLASS } from "./dialog";

describe("dialog positioning", () => {
  it("keeps centering independent from content transforms", () => {
    expect(DIALOG_VIEWPORT_CLASS).toContain("place-items-center");
    expect(DIALOG_CONTENT_CLASS).not.toMatch(
      /left-1\/2|top-1\/2|-translate-[xy]-1\/2/,
    );
  });
});
