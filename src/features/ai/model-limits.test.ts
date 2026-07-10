import { beforeEach, describe, expect, it, vi } from "vitest";

const { modelLimits } = vi.hoisted(() => ({ modelLimits: vi.fn() }));

vi.mock("@/lib/ipc", () => ({
  ipc: { ai: { modelLimits } },
}));

import { clearModelLimitsCache, resolveModelLimits } from "./model-limits";

beforeEach(() => {
  clearModelLimitsCache();
  modelLimits.mockReset();
  vi.useRealTimers();
});

describe("resolveModelLimits", () => {
  it("deduplicates concurrent metadata requests", async () => {
    modelLimits.mockResolvedValue({
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
    });

    const [first, second] = await Promise.all([
      resolveModelLimits("model-a"),
      resolveModelLimits("model-a"),
    ]);

    expect(first).toEqual(second);
    expect(modelLimits).toHaveBeenCalledTimes(1);
  });

  it("can be invalidated after an AI provider configuration change", async () => {
    modelLimits
      .mockResolvedValueOnce({ contextWindow: 32_000, maxOutputTokens: 4_096 })
      .mockResolvedValueOnce({
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
      });

    await resolveModelLimits("shared-name");
    clearModelLimitsCache();
    const refreshed = await resolveModelLimits("shared-name");

    expect(refreshed?.contextWindow).toBe(200_000);
    expect(modelLimits).toHaveBeenCalledTimes(2);
  });

  it("uses a short-lived fallback when metadata lookup fails", async () => {
    modelLimits.mockRejectedValue(new Error("offline"));

    await expect(resolveModelLimits("offline-model")).resolves.toBeNull();
    await expect(resolveModelLimits("offline-model")).resolves.toBeNull();

    expect(modelLimits).toHaveBeenCalledTimes(1);
  });
});
