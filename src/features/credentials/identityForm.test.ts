import { describe, expect, it } from "vitest";

import { identityPasswordSubmissionValue } from "./identityForm";

describe("identityPasswordSubmissionValue", () => {
  it("preserves an existing password when the edit field is blank", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "",
        clearSavedPassword: false,
      }),
    ).toBeUndefined();
  });

  it("replaces or explicitly clears an existing password", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "replacement",
        clearSavedPassword: false,
      }),
    ).toBe("replacement");
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "",
        clearSavedPassword: true,
      }),
    ).toBe("");
  });

  it("clears a stale password after changing the auth method", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "agent",
        value: "ignored",
        clearSavedPassword: false,
      }),
    ).toBeNull();
  });
});
