const PROMPT_TAIL = /.*[$#%❯➜]\s(.*)$/;
const PROMPT_ONLY = /[$#%❯➜]\s*$/;

export function isShellPromptLine(line: string): boolean {
  return PROMPT_ONLY.test(line.trimEnd());
}

export function extractCommand(line: string): string | null {
  const trimmed = line.replace(/\s+$/, "");
  if (!trimmed) return null;
  const match = trimmed.match(PROMPT_TAIL);
  if (!match && isShellPromptLine(trimmed)) return null;
  const command = (match ? match[1] : trimmed).trim();
  if (!command || command.length > 500 || command.includes("\n")) return null;
  return command;
}

export function currentInput(line: string): string {
  const match = line.match(PROMPT_TAIL);
  return match ? match[1] : line.replace(/^\s+/, "");
}

export function suggest(input: string, candidates: string[]): string | null {
  if (!input.trim()) return null;
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate.length > input.length && candidate.startsWith(input)) {
      return candidate.slice(input.length);
    }
  }
  return null;
}
