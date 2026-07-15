import { describe, expect, it } from "vitest";

import { passwordSubmissionValue } from "./hostForm";

describe("passwordSubmissionValue", () => {
  it("keeps a saved password when the edit field is blank", () => {
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "",
        clearSavedPassword: false,
      }),
    ).toBeUndefined();
  });

  it("replaces or explicitly clears a saved password", () => {
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "replacement",
        clearSavedPassword: false,
      }),
    ).toBe("replacement");
    expect(
      passwordSubmissionValue({
        authType: "password",
        value: "",
        clearSavedPassword: true,
      }),
    ).toBe("");
  });

  it("clears stale passwords when changing authentication method", () => {
    expect(
      passwordSubmissionValue({
        authType: "agent",
        value: "ignored",
        clearSavedPassword: false,
      }),
    ).toBeNull();
  });
});
