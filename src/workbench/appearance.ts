export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 5;

export function normalizeZoomLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(ZOOM_LEVEL_MIN, Math.min(Math.round(value), ZOOM_LEVEL_MAX));
}

const MAX_FONT_FAMILY_BYTES = 1024;
const encoder = new TextEncoder();

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== "string") return "";

  let normalized = "";
  let byteLength = 0;
  for (const character of value) {
    if (isControlCharacter(character)) continue;
    const characterBytes = encoder.encode(character).byteLength;
    if (byteLength + characterBytes > MAX_FONT_FAMILY_BYTES) break;
    normalized += character;
    byteLength += characterBytes;
  }
  return normalized;
}
