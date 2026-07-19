import { beforeEach, describe, expect, it, vi } from "vitest";

const { getConfig, setConfig, setModel } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  setModel: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ai: { getConfig, setConfig, setModel },
  },
}));

import { administrationTools } from "./administration";

const updateAiSettings = administrationTools.find(
  (tool) => tool.spec.name === "update_ai_settings",
);

describe("administration tools", () => {
  beforeEach(() => {
    getConfig.mockReset();
    setConfig.mockReset();
    setModel.mockReset();
    getConfig.mockResolvedValue({
      baseUrl: "https://example.com/v1",
      protocol: "openai",
      autoApprove: false,
      enabledTools: null,
      maxHistoryTokens: null,
    });
    setConfig.mockResolvedValue(undefined);
    setModel.mockResolvedValue(undefined);
  });

  it("preserves an unset tool scope during partial AI updates", async () => {
    const result = await updateAiSettings?.execute?.({ autoApprove: true }, {});

    expect(result?.isError).toBe(false);
    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprove: true,
        enabledTools: undefined,
      }),
    );
  });

  it("can clear the API key, base URL, and selected model", async () => {
    const result = await updateAiSettings?.execute?.(
      { apiKey: "", baseUrl: "", model: "" },
      {},
    );

    expect(result?.isError).toBe(false);
    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "", baseUrl: "" }),
    );
    expect(setModel).toHaveBeenCalledWith("");
  });
});
