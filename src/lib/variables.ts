export interface TemplateVariable {
  name: string;
  defaultValue: string;
}

const PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*(?::([^}]*))?\}\}/g;

export function parseVariables(...sources: string[]): TemplateVariable[] {
  const seen = new Map<string, TemplateVariable>();
  for (const source of sources) {
    for (const match of source.matchAll(PATTERN)) {
      const name = match[1];
      const defaultValue = (match[2] ?? "").trim();
      const existing = seen.get(name);
      if (!existing || (!existing.defaultValue && defaultValue)) {
        seen.set(name, { name, defaultValue });
      }
    }
  }
  return [...seen.values()];
}

export function substitute(
  text: string,
  values: Record<string, string>,
): string {
  const defaults = new Map(
    parseVariables(text).map((variable) => [
      variable.name,
      variable.defaultValue,
    ]),
  );
  return text.replace(PATTERN, (_, name: string, fallback?: string) => {
    const provided = values[name];
    if (provided !== undefined && provided.trim() !== "") return provided;
    return defaults.get(name) ?? (fallback ?? "").trim();
  });
}
