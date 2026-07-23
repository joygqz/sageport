import { describe, expect, it } from "vitest";

import { passwordSubmissionValue } from "./hostForm";

describe("passwordSubmissionValue", () => {
  it("keeps a saved password when the edit field is blank", () => {
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "",
        edited: false,
      }),
    ).toBeUndefined();
  });

  it("replaces or explicitly clears a saved password", () => {
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "replacement",
        edited: true,
      }),
    ).toBe("replacement");
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "",
        edited: true,
      }),
    ).toBe("");
  });

  it("clears stale passwords when changing authentication method", () => {
    expect(
      passwordSubmissionValue({
        authType: "agent",
        value: "ignored",
        edited: true,
      }),
    ).toBeNull();
  });
});
