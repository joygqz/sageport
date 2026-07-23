import { describe, expect, it } from "vitest";

import { identityPasswordSubmissionValue } from "./identityForm";

describe("identityPasswordSubmissionValue", () => {
  it("preserves an existing password when the edit field is blank", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "",
        edited: false,
      }),
    ).toBeUndefined();
  });

  it("replaces or explicitly clears an existing password", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "replacement",
        edited: true,
      }),
    ).toBe("replacement");
    expect(
      identityPasswordSubmissionValue({
        authType: "password",
        value: "",
        edited: true,
      }),
    ).toBe("");
  });

  it("clears a stale password after changing the auth method", () => {
    expect(
      identityPasswordSubmissionValue({
        authType: "agent",
        value: "ignored",
        edited: true,
      }),
    ).toBeNull();
  });
});
