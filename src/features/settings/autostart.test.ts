import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-autostart", () => mocks);

import { readAutostart, writeAutostart } from "./autostart";

describe("autostart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the operating system registration", async () => {
    mocks.isEnabled.mockResolvedValue(true);

    await expect(readAutostart()).resolves.toBe(true);
    expect(mocks.isEnabled).toHaveBeenCalledOnce();
  });

  it("enables autostart and verifies the resulting state", async () => {
    mocks.enable.mockResolvedValue(undefined);
    mocks.isEnabled.mockResolvedValue(true);

    await expect(writeAutostart(true)).resolves.toBe(true);
    expect(mocks.enable).toHaveBeenCalledOnce();
    expect(mocks.disable).not.toHaveBeenCalled();
  });

  it("disables autostart and verifies the resulting state", async () => {
    mocks.disable.mockResolvedValue(undefined);
    mocks.isEnabled.mockResolvedValue(false);

    await expect(writeAutostart(false)).resolves.toBe(false);
    expect(mocks.disable).toHaveBeenCalledOnce();
    expect(mocks.enable).not.toHaveBeenCalled();
  });
});
