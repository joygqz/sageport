export function workbenchShortcutKey(event: KeyboardEvent): string {
  if (event.code === "BracketLeft") return "[";
  if (event.code === "BracketRight") return "]";
  if (event.code === "Backslash") return "\\";
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
  if (/^[1-9]$/.test(key)) return !event.shiftKey;
  if (key === "p" || key === "b") return true;
  if (key === "n") return !event.shiftKey;
  if (key === ",") return !event.shiftKey;
  if (key === "t") return event.shiftKey;
  if (["j", "l", "w", "f"].includes(key)) return !event.shiftKey;
  if (key === "[" || key === "]") return true;
  if (key === "\\") return true;
  return (
    key === "=" || key === "+" || key === "-" || key === "_" || key === "0"
  );
}
