export const SIDE_BAR_FILTER_THRESHOLD = 8;

export function shouldShowSideBarFilter(
  itemCount: number,
  value: string,
  threshold = SIDE_BAR_FILTER_THRESHOLD,
) {
  return itemCount > threshold || value.trim().length > 0;
}
