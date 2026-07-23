export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.host) {
      return url.href;
    }
  } catch {}
  return null;
}
