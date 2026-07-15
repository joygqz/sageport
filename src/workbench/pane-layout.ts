export type SplitDirection = "row" | "column";

export type PaneLayout =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      id: string;
      direction: SplitDirection;
      children: PaneLayout[];
      sizes: number[];
    };

export function leafLayout(paneId: string): PaneLayout {
  return { type: "leaf", paneId };
}

export function layoutPaneIds(layout: PaneLayout): string[] {
  if (layout.type === "leaf") return [layout.paneId];
  return layout.children.flatMap(layoutPaneIds);
}

export function splitLayout(
  layout: PaneLayout,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection,
): PaneLayout {
  if (layout.type === "leaf") {
    if (layout.paneId !== targetPaneId) return layout;
    return {
      type: "split",
      id: crypto.randomUUID(),
      direction,
      children: [layout, leafLayout(newPaneId)],
      sizes: [0.5, 0.5],
    };
  }
  if (layout.direction === direction) {
    const index = layout.children.findIndex(
      (child) => child.type === "leaf" && child.paneId === targetPaneId,
    );
    if (index !== -1) {
      const children = [...layout.children];
      const sizes = [...layout.sizes];
      const half = sizes[index] / 2;
      sizes[index] = half;
      children.splice(index + 1, 0, leafLayout(newPaneId));
      sizes.splice(index + 1, 0, half);
      return { ...layout, children, sizes };
    }
  }
  const children = layout.children.map((child) =>
    splitLayout(child, targetPaneId, newPaneId, direction),
  );
  return children.every((child, i) => child === layout.children[i])
    ? layout
    : { ...layout, children };
}

export function removeLayoutPane(
  layout: PaneLayout,
  paneId: string,
): PaneLayout | null {
  if (layout.type === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }
  const children: PaneLayout[] = [];
  const sizes: number[] = [];
  let changed = false;
  layout.children.forEach((child, i) => {
    const next = removeLayoutPane(child, paneId);
    if (next === null) {
      changed = true;
      return;
    }
    if (next !== child) changed = true;
    children.push(next);
    sizes.push(layout.sizes[i]);
  });
  if (!changed) return layout;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return {
    ...layout,
    children,
    sizes: sizes.map((size) => (total > 0 ? size / total : 1 / sizes.length)),
  };
}

export function resizeSplitNode(
  layout: PaneLayout,
  splitId: string,
  sizes: number[],
): PaneLayout {
  if (layout.type === "leaf") return layout;
  if (layout.id === splitId) {
    if (sizes.length !== layout.children.length) return layout;
    return { ...layout, sizes };
  }
  const children = layout.children.map((child) =>
    resizeSplitNode(child, splitId, sizes),
  );
  return children.every((child, i) => child === layout.children[i])
    ? layout
    : { ...layout, children };
}

export function layoutExtent(layout: PaneLayout, axis: SplitDirection): number {
  if (layout.type === "leaf") return 1;
  const extents = layout.children.map((child) => layoutExtent(child, axis));
  return layout.direction === axis
    ? extents.reduce((sum, n) => sum + n, 0)
    : Math.max(...extents);
}

export function neighborPaneId(
  layout: PaneLayout,
  paneId: string,
): string | null {
  const ids = layoutPaneIds(layout);
  const index = ids.indexOf(paneId);
  if (index === -1) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}
