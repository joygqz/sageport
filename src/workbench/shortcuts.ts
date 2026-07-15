export function workbenchShortcutKey(event: KeyboardEvent): string {
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  return event.key.toLowerCase();
}

export function isWorkbenchShortcut(
  event: KeyboardEvent,
  isMacOS = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform),
): boolean {
  const primaryModifier = isMacOS ? event.metaKey : event.ctrlKey;
  const secondaryModifier = isMacOS ? event.ctrlKey : event.metaKey;
  if (!primaryModifier || secondaryModifier || event.altKey) return false;

  const key = workbenchShortcutKey(event);
  if (key === "p" || key === "b") return true;
  if (key === "n") return !event.shiftKey;
  if (key === ",") return !event.shiftKey;
  if (key === "t") return event.shiftKey;
  if (["j", "l", "w", "f"].includes(key)) return !event.shiftKey;
  if (key === "[" || key === "]") return event.shiftKey;
  return (
    key === "=" || key === "+" || key === "-" || key === "_" || key === "0"
  );
}
