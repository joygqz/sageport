import type { TKey } from "@/i18n";

export const SUGGESTION_POOL = [
  {
    group: "core",
    keys: [
      "ai.suggestion.core.terminalOutput",
      "ai.suggestion.core.resourceUsage",
      "ai.suggestion.core.systemLogs",
    ],
  },
  {
    group: "terminal",
    keys: [
      "ai.suggestion.terminal.gitHistory",
      "ai.suggestion.terminal.commonCommands",
      "ai.suggestion.terminal.dockerHistory",
    ],
  },
  {
    group: "hosts",
    keys: [
      "ai.suggestion.hosts.health",
      "ai.suggestion.hosts.inventory",
      "ai.suggestion.hosts.stats",
    ],
  },
  {
    group: "files",
    keys: [
      "ai.suggestion.files.largeFiles",
      "ai.suggestion.files.config",
      "ai.suggestion.files.bookmarks",
    ],
  },
  {
    group: "snippets",
    keys: [
      "ai.suggestion.snippets.inventory",
      "ai.suggestion.snippets.save",
      "ai.suggestion.snippets.runOnHosts",
    ],
  },
  {
    group: "tasks",
    keys: [
      "ai.suggestion.tasks.inventory",
      "ai.suggestion.tasks.runs",
      "ai.suggestion.tasks.create",
    ],
  },
  {
    group: "forwards",
    keys: [
      "ai.suggestion.forwards.inventory",
      "ai.suggestion.forwards.start",
      "ai.suggestion.forwards.create",
    ],
  },
  {
    group: "credentials",
    keys: [
      "ai.suggestion.credentials.inventory",
      "ai.suggestion.credentials.generateKey",
      "ai.suggestion.credentials.audit",
    ],
  },
  {
    group: "settings",
    keys: [
      "ai.suggestion.settings.overview",
      "ai.suggestion.settings.models",
      "ai.suggestion.settings.limits",
    ],
  },
  {
    group: "sync",
    keys: [
      "ai.suggestion.sync.status",
      "ai.suggestion.sync.push",
      "ai.suggestion.sync.versions",
    ],
  },
  {
    group: "updates",
    keys: [
      "ai.suggestion.updates.check",
      "ai.suggestion.updates.status",
      "ai.suggestion.updates.install",
    ],
  },
] as const satisfies readonly {
  group: string;
  keys: readonly TKey[];
}[];

export interface Suggestion {
  group: (typeof SUGGESTION_POOL)[number]["group"];
  key: TKey;
}

export function pickSuggestions(
  enabledGroups: readonly Suggestion["group"][],
  random: () => number = Math.random,
): Suggestion[] {
  const enabled = new Set(enabledGroups);
  const groups = SUGGESTION_POOL.filter(({ group }) => enabled.has(group));
  if (groups.length === 0) return [];

  for (let index = groups.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [groups[index], groups[swapIndex]] = [groups[swapIndex], groups[index]];
  }

  const selectedGroups = groups.slice(0, 3);
  while (selectedGroups.length < 3) {
    selectedGroups.push(groups[Math.floor(random() * groups.length)]);
  }

  const usedKeys = new Set<TKey>();
  return selectedGroups.map(({ group, keys }) => {
    const availableKeys = keys.filter((key) => !usedKeys.has(key));
    const key = availableKeys[Math.floor(random() * availableKeys.length)];
    usedKeys.add(key);
    return { group, key };
  });
}

export function pickSuggestionsForSession(
  sessionId: string,
  enabledGroups: readonly Suggestion["group"][],
): Suggestion[] {
  let state = 2_166_136_261;
  for (let index = 0; index < sessionId.length; index += 1) {
    state = Math.imul(state ^ sessionId.charCodeAt(index), 16_777_619);
  }

  return pickSuggestions(enabledGroups, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  });
}
