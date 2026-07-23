import { describe, expect, it } from "vitest";

import { en } from "./en";
import { zhCN } from "./zh-CN";

function leafPaths(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, v]) => leafPaths(v, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

function leafEntries(value: unknown, prefix = ""): Array<[string, string]> {
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, v]) => leafEntries(v, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, String(value)]];
}

describe("locale parity", () => {
  const enKeys = new Set(leafPaths(en));
  const zhKeys = new Set(leafPaths(zhCN));

  it("zh-CN has every en key", () => {
    const missing = [...enKeys].filter((k) => !zhKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("en has every zh-CN key", () => {
    const extra = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(extra).toEqual([]);
  });

  it.each([
    ["en", en],
    ["zh-CN", zhCN],
  ])("%s strings have consistent spacing and ellipses", (_locale, dict) => {
    const invalid = leafEntries(dict).filter(([, value]) => {
      return (
        value !== value.trim() || value.includes("...") || / {2,}/.test(value)
      );
    });
    expect(invalid).toEqual([]);
  });

  it("uses sentence case for English copy", () => {
    const properWords = new Set([
      "AI",
      "API",
      "Anthropic",
      "Anthropic-compatible",
      "AWS",
      "CPU",
      "D",
      "Docker",
      "Drive",
      "Ed25519",
      "Enter",
      "Git",
      "GitHub",
      "Google",
      "I",
      "ID",
      "JSON",
      "L",
      "MB",
      "MinIO",
      "Nextcloud",
      "OAuth",
      "Ollama",
      "OneDrive",
      "OpenAI",
      "OpenAI-compatible",
      "OpenSSH",
      "P-256",
      "P-384",
      "P-521",
      "PEM",
      "R",
      "R2",
      "S3",
      "S3-compatible",
      "SSH",
      "SOCKS",
      "Sageport",
      "Synology",
      "URL",
      "WebDAV",
    ]);
    const invalid = leafEntries(en).flatMap(([key, value]) => {
      const firstClause = value.split(/[.!?]/, 1)[0];
      const capitalized = firstClause.match(/\b[A-Z][A-Za-z\d-]*/g) ?? [];
      const unexpected = capitalized
        .slice(1)
        .filter((word) => !properWords.has(word));
      return unexpected.length ? [[key, value, unexpected]] : [];
    });
    expect(invalid).toEqual([]);
  });
});
