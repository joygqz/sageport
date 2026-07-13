export interface SelectionInput {
  paths: string[];
  selected: string[];
  target: string;
  anchor: string | null;
  toggle?: boolean;
  range?: boolean;
}

export interface SelectionResult {
  selected: string[];
  anchor: string;
}

export function nextFileSelection({
  paths,
  selected,
  target,
  anchor,
  toggle = false,
  range = false,
}: SelectionInput): SelectionResult {
  if (range && anchor) {
    const anchorIndex = paths.indexOf(anchor);
    const targetIndex = paths.indexOf(target);
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const span = paths.slice(start, end + 1);
      return {
        selected: toggle ? [...new Set([...selected, ...span])] : span,
        anchor,
      };
    }
  }

  if (toggle) {
    return {
      selected: selected.includes(target)
        ? selected.filter((path) => path !== target)
        : [...selected, target],
      anchor: target,
    };
  }

  return { selected: [target], anchor: target };
}
