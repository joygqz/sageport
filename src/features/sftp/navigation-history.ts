export const NAVIGATION_HISTORY_LIMIT = 50;

export interface NavigationHistory {
  history: string[];
  historyIndex: number;
}

export function pushNavigationHistory(
  current: NavigationHistory,
  path: string,
): NavigationHistory {
  if (current.history[current.historyIndex] === path) return current;

  const entries = [...current.history.slice(0, current.historyIndex + 1), path];
  const history = entries.slice(-NAVIGATION_HISTORY_LIMIT);
  return { history, historyIndex: history.length - 1 };
}
