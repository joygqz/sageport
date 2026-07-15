import { describe, expect, it } from "vitest";

import { safeExternalUrl } from "./links";

describe("safeExternalUrl", () => {
  it("allows absolute web links", () => {
    expect(safeExternalUrl("https://example.com/docs?q=1")).toBe(
      "https://example.com/docs?q=1",
    );
    expect(safeExternalUrl("http://localhost:3000/status")).toBe(
      "http://localhost:3000/status",
    );
  });

  it("blocks local, executable, and relative links from model output", () => {
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("mailto:ops@example.com")).toBeNull();
    expect(safeExternalUrl("/relative/path")).toBeNull();
  });
});
