export function clampPaletteIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(index, 0), itemCount - 1);
}

export function movePaletteIndex(
  index: number,
  offset: -1 | 1,
  itemCount: number,
): number {
  return clampPaletteIndex(
    clampPaletteIndex(index, itemCount) + offset,
    itemCount,
  );
}

export function fuzzyPaletteMatch(query: string, text: string): boolean {
  const queryCharacters = Array.from(query.toLocaleLowerCase());
  if (queryCharacters.length === 0) return true;

  let index = 0;
  for (const character of text.toLocaleLowerCase()) {
    if (character === queryCharacters[index]) index += 1;
    if (index === queryCharacters.length) return true;
  }
  return false;
}

type PointerPosition = { x: number; y: number };

export function hasPointerMoved(
  previous: PointerPosition | null,
  next: PointerPosition,
  initialMovement: PointerPosition,
): boolean {
  return previous
    ? previous.x !== next.x || previous.y !== next.y
    : initialMovement.x !== 0 || initialMovement.y !== 0;
}
