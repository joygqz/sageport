import { AI_PROTOCOLS } from "@/features/ai/api";
import {
  normalizeEnabledToolNames,
  resolveEnabledToolNames,
  TOOL_GROUPS,
} from "@/features/ai/tools";
import { LOCALES } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { THEME_FAMILIES, type ThemeMode } from "@/themes";
import { DEFAULT_THEME_FAMILY_ID, DEFAULT_THEME_MODE } from "@/themes/themes";
import type { AiConfig, AiProtocol } from "@/types/models";
import { ZOOM_LEVEL_MAX, ZOOM_LEVEL_MIN } from "@/workbench/appearance";

export interface JsonSettingsValues {
  "general.locale": Locale;
  "general.theme": string;
  "general.fontFamily": string;
  "general.zoomLevel": number;
  "ai.protocol": AiProtocol;
  "ai.base_url": string;
  "ai.api_key": string;
  "ai.model": string;
  "ai.auto_approve": boolean;
  "ai.enabled_tools": string[];
  "ai.max_history_tokens": number | null;
}

export type JsonSettingsDocument = Partial<JsonSettingsValues>;

export type JsonSettingsIssue =
  | { kind: "syntax" }
  | { kind: "root" }
  | { kind: "unknown"; key: string }
  | { kind: "invalid"; key: keyof JsonSettingsValues };

export type JsonSettingsParseResult =
  | { ok: true; value: JsonSettingsDocument }
  | { ok: false; issue: JsonSettingsIssue };

const SETTING_KEYS = [
  "general.locale",
  "general.theme",
  "general.fontFamily",
  "general.zoomLevel",
  "ai.protocol",
  "ai.base_url",
  "ai.api_key",
  "ai.model",
  "ai.auto_approve",
  "ai.enabled_tools",
  "ai.max_history_tokens",
] as const satisfies readonly (keyof JsonSettingsValues)[];

const SETTING_KEY_SET = new Set<string>(SETTING_KEYS);
const THEME_OPTIONS = THEME_FAMILIES.flatMap((family) =>
  (["system", "light", "dark"] as const).map((mode) => `${family.id}:${mode}`),
);
const THEME_VALUES = new Set(THEME_OPTIONS);
const TOOL_NAMES = new Set(
  TOOL_GROUPS.flatMap((group) => group.tools.map((tool) => tool.spec.name)),
);
const OPTIONAL_TOOL_OPTIONS = resolveEnabledToolNames(null);
const OPTIONAL_TOOL_NAMES = new Set(OPTIONAL_TOOL_OPTIONS);
const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    encoder.encode(value).byteLength <= maxBytes &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })
  );
}

function invalid(key: keyof JsonSettingsValues): JsonSettingsParseResult {
  return { ok: false, issue: { kind: "invalid", key } };
}

function equalSettingValue(
  left: JsonSettingsValues[keyof JsonSettingsValues],
  right: JsonSettingsValues[keyof JsonSettingsValues],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function themePreferenceFromJson(value: string): {
  familyId: string;
  mode: ThemeMode;
} {
  const [familyId, mode] = value.split(":");
  return { familyId, mode: mode as ThemeMode };
}

export function defaultJsonSettings(locale: Locale): JsonSettingsValues {
  return {
    "general.locale": locale,
    "general.theme": `${DEFAULT_THEME_FAMILY_ID}:${DEFAULT_THEME_MODE}`,
    "general.fontFamily": "",
    "general.zoomLevel": 0,
    "ai.protocol": "openai",
    "ai.base_url": "",
    "ai.api_key": "",
    "ai.model": "",
    "ai.auto_approve": false,
    "ai.enabled_tools": resolveEnabledToolNames(null),
    "ai.max_history_tokens": null,
  };
}

export function createJsonSettingsValues(input: {
  locale: Locale;
  theme: string;
  fontFamily: string;
  zoomLevel: number;
  ai: AiConfig;
}): JsonSettingsValues {
  return {
    "general.locale": input.locale,
    "general.theme": input.theme,
    "general.fontFamily": input.fontFamily,
    "general.zoomLevel": input.zoomLevel,
    "ai.protocol": input.ai.protocol,
    "ai.base_url": input.ai.baseUrl,
    "ai.api_key": input.ai.apiKey,
    "ai.model": input.ai.model,
    "ai.auto_approve": input.ai.autoApprove,
    "ai.enabled_tools": resolveEnabledToolNames(input.ai.enabledTools),
    "ai.max_history_tokens": input.ai.maxHistoryTokens,
  };
}

export function createJsonSettingsDocument(
  values: JsonSettingsValues,
  defaults: JsonSettingsValues,
): JsonSettingsDocument {
  return Object.fromEntries(
    SETTING_KEYS.filter(
      (key) => !equalSettingValue(values[key], defaults[key]),
    ).map((key) => [key, values[key]]),
  ) as JsonSettingsDocument;
}

export function resolveJsonSettings(
  document: JsonSettingsDocument,
  defaults: JsonSettingsValues,
): JsonSettingsValues {
  return { ...defaults, ...document };
}

export function jsonSettingsSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      "general.locale": {
        type: "string",
        enum: [...LOCALES],
      },
      "general.theme": {
        type: "string",
        enum: THEME_OPTIONS,
      },
      "general.fontFamily": {
        type: "string",
        maxLength: 1024,
      },
      "general.zoomLevel": {
        type: "integer",
        minimum: ZOOM_LEVEL_MIN,
        maximum: ZOOM_LEVEL_MAX,
      },
      "ai.protocol": {
        type: "string",
        enum: AI_PROTOCOLS.map((protocol) => protocol.value),
      },
      "ai.base_url": {
        type: "string",
        maxLength: 8192,
      },
      "ai.api_key": {
        type: "string",
        maxLength: 16384,
      },
      "ai.model": {
        type: "string",
        maxLength: 1024,
      },
      "ai.auto_approve": {
        type: "boolean",
      },
      "ai.enabled_tools": {
        type: "array",
        uniqueItems: true,
        maxItems: 256,
        items: {
          type: "string",
          enum: OPTIONAL_TOOL_OPTIONS,
        },
      },
      "ai.max_history_tokens": {
        type: ["integer", "null"],
        minimum: 1,
        maximum: 4_294_967_295,
      },
    },
  };
}

export function stringifyJsonSettings(document: JsonSettingsDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseJsonSettings(text: string): JsonSettingsParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issue: { kind: "syntax" } };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, issue: { kind: "root" } };
  }

  for (const key of Object.keys(raw)) {
    if (!SETTING_KEY_SET.has(key)) {
      return { ok: false, issue: { kind: "unknown", key } };
    }
  }

  const patch: JsonSettingsDocument = {};
  const has = (key: keyof JsonSettingsValues) =>
    Object.prototype.hasOwnProperty.call(raw, key);

  if (has("general.locale")) {
    const value = raw["general.locale"];
    if (
      typeof value !== "string" ||
      !(LOCALES as readonly string[]).includes(value)
    ) {
      return invalid("general.locale");
    }
    patch["general.locale"] = value as Locale;
  }

  if (has("general.theme")) {
    const value = raw["general.theme"];
    if (typeof value !== "string" || !THEME_VALUES.has(value)) {
      return invalid("general.theme");
    }
    patch["general.theme"] = value;
  }

  if (has("general.fontFamily")) {
    const value = raw["general.fontFamily"];
    if (!isBoundedText(value, 1024)) {
      return invalid("general.fontFamily");
    }
    patch["general.fontFamily"] = value;
  }

  if (has("general.zoomLevel")) {
    const value = raw["general.zoomLevel"];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < ZOOM_LEVEL_MIN ||
      value > ZOOM_LEVEL_MAX
    ) {
      return invalid("general.zoomLevel");
    }
    patch["general.zoomLevel"] = value;
  }

  if (has("ai.protocol")) {
    const value = raw["ai.protocol"];
    if (
      typeof value !== "string" ||
      !AI_PROTOCOLS.some((protocol) => protocol.value === value)
    ) {
      return invalid("ai.protocol");
    }
    patch["ai.protocol"] = value as AiProtocol;
  }

  if (has("ai.base_url")) {
    const value = raw["ai.base_url"];
    if (!isBoundedText(value, 8192)) {
      return invalid("ai.base_url");
    }
    patch["ai.base_url"] = value;
  }

  if (has("ai.api_key")) {
    const value = raw["ai.api_key"];
    if (!isBoundedText(value, 16384)) {
      return invalid("ai.api_key");
    }
    patch["ai.api_key"] = value.trim();
  }

  if (has("ai.model")) {
    const value = raw["ai.model"];
    if (!isBoundedText(value, 1024)) {
      return invalid("ai.model");
    }
    patch["ai.model"] = value.trim();
  }

  if (has("ai.auto_approve")) {
    const value = raw["ai.auto_approve"];
    if (typeof value !== "boolean") {
      return invalid("ai.auto_approve");
    }
    patch["ai.auto_approve"] = value;
  }

  if (has("ai.enabled_tools")) {
    const value = raw["ai.enabled_tools"];
    if (
      !Array.isArray(value) ||
      value.some(
        (name) =>
          typeof name !== "string" ||
          !TOOL_NAMES.has(name) ||
          !OPTIONAL_TOOL_NAMES.has(name),
      )
    ) {
      return invalid("ai.enabled_tools");
    }
    patch["ai.enabled_tools"] = normalizeEnabledToolNames(value);
  }

  if (has("ai.max_history_tokens")) {
    const value = raw["ai.max_history_tokens"];
    if (
      value !== null &&
      (typeof value !== "number" ||
        !Number.isInteger(value) ||
        value <= 0 ||
        value > 4_294_967_295)
    ) {
      return invalid("ai.max_history_tokens");
    }
    patch["ai.max_history_tokens"] = value;
  }

  return { ok: true, value: patch };
}
