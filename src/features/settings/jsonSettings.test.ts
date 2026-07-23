import { describe, expect, it } from "vitest";

import {
  createJsonSettingsDocument,
  createJsonSettingsValues,
  defaultJsonSettings,
  parseJsonSettings,
  resolveJsonSettings,
  stringifyJsonSettings,
} from "./jsonSettings";

const defaults = defaultJsonSettings("en");

describe("JSON settings", () => {
  it("omits default values and secrets", () => {
    const values = createJsonSettingsValues({
      locale: "en",
      theme: "midnight:dark",
      fontFamily: "",
      zoomLevel: 0,
      ai: {
        hasApiKey: true,
        protocol: "openai",
        baseUrl: "",
        model: "",
        autoApprove: false,
        enabledTools: null,
        maxHistoryTokens: null,
      },
    });
    const text = stringifyJsonSettings(
      createJsonSettingsDocument(values, defaults),
    );

    expect(text).toBe("{}\n");
    expect(text).not.toContain("hasApiKey");
  });

  it("uses persisted setting keys for overrides", () => {
    const values = createJsonSettingsValues({
      locale: "zh-CN",
      theme: "graphite:system",
      fontFamily: "JetBrains Mono",
      zoomLevel: 1,
      ai: {
        hasApiKey: false,
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet",
        autoApprove: true,
        enabledTools: [],
        maxHistoryTokens: 200_000,
      },
    });
    const document = createJsonSettingsDocument(values, defaults);

    expect(parseJsonSettings(stringifyJsonSettings(document))).toEqual({
      ok: true,
      value: document,
    });
    expect(document).toMatchObject({
      "ai.base_url": "https://api.anthropic.com",
      "ai.auto_approve": true,
      "ai.enabled_tools": [],
      "ai.max_history_tokens": 200_000,
    });
  });

  it("restores defaults when an override is removed", () => {
    expect(
      resolveJsonSettings({ "general.zoomLevel": 2 }, defaults),
    ).toMatchObject({
      "general.zoomLevel": 2,
      "ai.protocol": "openai",
      "ai.base_url": "",
    });
    expect(resolveJsonSettings({}, defaults)).toEqual(defaults);
  });

  it("rejects malformed JSON and unsupported settings", () => {
    expect(parseJsonSettings("{")).toEqual({
      ok: false,
      issue: { kind: "syntax" },
    });
    expect(
      parseJsonSettings('{ "ai.baseUrl": "https://example.com" }'),
    ).toEqual({
      ok: false,
      issue: { kind: "unknown", key: "ai.baseUrl" },
    });
  });

  it("rejects invalid values", () => {
    expect(parseJsonSettings('{ "general.zoomLevel": 6 }')).toEqual({
      ok: false,
      issue: { kind: "invalid", key: "general.zoomLevel" },
    });
    expect(parseJsonSettings('{ "general.theme": "unknown:dark" }')).toEqual({
      ok: false,
      issue: { kind: "invalid", key: "general.theme" },
    });
    expect(parseJsonSettings('{ "ai.max_history_tokens": 0 }')).toEqual({
      ok: false,
      issue: { kind: "invalid", key: "ai.max_history_tokens" },
    });
  });
});
