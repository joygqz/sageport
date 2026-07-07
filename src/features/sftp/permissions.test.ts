import { describe, expect, it } from "vitest";

import { hasBit, modeToOctal, octalToMode, toggleBit } from "./permissions";

describe("permissions helpers", () => {
  it("formats a mode as three octal digits", () => {
    expect(modeToOctal(0o755)).toBe("755");
    expect(modeToOctal(0o40755)).toBe("755");
    expect(modeToOctal(0o600)).toBe("600");
  });

  it("parses valid octal strings and rejects invalid ones", () => {
    expect(octalToMode("644")).toBe(0o644);
    expect(octalToMode("0755")).toBe(0o755);
    expect(octalToMode("8")).toBeNull();
    expect(octalToMode("abc")).toBeNull();
    expect(octalToMode("")).toBeNull();
  });

  it("reads individual permission bits", () => {
    const mode = 0o754;
    expect(hasBit(mode, "owner", "read")).toBe(true);
    expect(hasBit(mode, "owner", "execute")).toBe(true);
    expect(hasBit(mode, "group", "write")).toBe(false);
    expect(hasBit(mode, "group", "execute")).toBe(true);
    expect(hasBit(mode, "others", "read")).toBe(true);
    expect(hasBit(mode, "others", "write")).toBe(false);
  });

  it("toggles a bit without touching the others", () => {
    expect(modeToOctal(toggleBit(0o644, "owner", "execute"))).toBe("744");
    expect(modeToOctal(toggleBit(0o744, "owner", "execute"))).toBe("644");
    expect(modeToOctal(toggleBit(0o000, "others", "read"))).toBe("004");
  });
});
