export interface AiToolCatalogEntry {
  name: string;
  required: boolean;
}

let catalog: readonly AiToolCatalogEntry[] = [];

export function setAiToolCatalog(entries: readonly AiToolCatalogEntry[]): void {
  catalog = entries.map((entry) => ({ ...entry }));
}

export function getAiToolCatalog(): readonly AiToolCatalogEntry[] {
  return catalog;
}
