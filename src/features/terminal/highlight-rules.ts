export const HIGHLIGHT_RULES_SYNC_KEY = "general.highlightRules";
export const MAX_HIGHLIGHT_RULES = 32;
export const MAX_HIGHLIGHT_PATTERN_LENGTH = 128;

export interface HighlightRule {
  id: string;
  pattern: string;
  caseSensitive: boolean;
  foreground: string | null;
  background: string | null;
  enabled: boolean;
}

export const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  {
    id: "example-debug",
    pattern: "DEBUG",
    caseSensitive: false,
    foreground: "#d8a0ff",
    background: "#43245c",
    enabled: true,
  },
  {
    id: "example-verbose",
    pattern: "VERBOSE",
    caseSensitive: false,
    foreground: "#8ab4ff",
    background: "#1f3d66",
    enabled: true,
  },
  {
    id: "example-warn",
    pattern: "WARN",
    caseSensitive: false,
    foreground: "#ffd166",
    background: "#59430f",
    enabled: true,
  },
  {
    id: "example-error",
    pattern: "ERROR",
    caseSensitive: false,
    foreground: "#ff6b6b",
    background: "#5a1d1d",
    enabled: true,
  },
  {
    id: "example-info",
    pattern: "INFO",
    caseSensitive: false,
    foreground: "#67d8ef",
    background: "#174653",
    enabled: true,
  },
  {
    id: "example-note",
    pattern: "NOTE",
    caseSensitive: false,
    foreground: "#79d7c4",
    background: "#174b43",
    enabled: true,
  },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeHighlightRules(value: unknown): HighlightRule[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const rules: HighlightRule[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      rules.length >= MAX_HIGHLIGHT_RULES
    )
      continue;
    const candidate = item as Partial<HighlightRule>;
    const id =
      typeof candidate.id === "string" ? candidate.id.slice(0, 64) : "";
    const pattern =
      typeof candidate.pattern === "string"
        ? candidate.pattern.slice(0, MAX_HIGHLIGHT_PATTERN_LENGTH)
        : "";
    const foreground =
      typeof candidate.foreground === "string" &&
      HEX_COLOR.test(candidate.foreground)
        ? candidate.foreground.toLowerCase()
        : null;
    const background =
      typeof candidate.background === "string" &&
      HEX_COLOR.test(candidate.background)
        ? candidate.background.toLowerCase()
        : null;
    if (!id || ids.has(id) || !pattern || (!foreground && !background))
      continue;
    ids.add(id);
    rules.push({
      id,
      pattern,
      caseSensitive: candidate.caseSensitive === true,
      foreground,
      background,
      enabled: candidate.enabled !== false,
    });
  }
  return rules;
}

export function parseHighlightRules(value: string): HighlightRule[] {
  try {
    return normalizeHighlightRules(JSON.parse(value));
  } catch {
    return [];
  }
}

export function serializeHighlightRules(rules: HighlightRule[]): string {
  return JSON.stringify(normalizeHighlightRules(rules));
}

export function findLiteralMatches(
  text: string,
  pattern: string,
  caseSensitive: boolean,
): Array<{ start: number; end: number }> {
  if (!pattern) return [];
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  const matches: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= source.length - needle.length) {
    const start = source.indexOf(needle, from);
    if (start < 0) break;
    matches.push({ start, end: start + needle.length });
    from = start + Math.max(needle.length, 1);
  }
  return matches;
}
