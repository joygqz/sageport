export interface TreeSelectNode {
  value: string;
  label: string;
  parentValue: string | null;
  disabled?: boolean;
}

export interface TreeSelectRootOption {
  value: string;
  label: string;
}

export interface TreeSelectRow extends TreeSelectNode {
  depth: number;
  hasChildren: boolean;
}

export function buildTreeSelectRows(
  nodes: readonly TreeSelectNode[],
  collapsed: ReadonlySet<string>,
): TreeSelectRow[] {
  const byValue = new Map<string, TreeSelectNode>();
  for (const node of nodes) {
    if (!byValue.has(node.value)) byValue.set(node.value, node);
  }

  const children = new Map<string | null, TreeSelectNode[]>();
  for (const node of byValue.values()) {
    const parent =
      node.parentValue &&
      node.parentValue !== node.value &&
      byValue.has(node.parentValue)
        ? node.parentValue
        : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }

  const rows: TreeSelectRow[] = [];
  const visited = new Set<string>();
  const hideDescendants = (nodeValue: string) => {
    for (const child of children.get(nodeValue) ?? []) {
      if (visited.has(child.value)) continue;
      visited.add(child.value);
      hideDescendants(child.value);
    }
  };
  const appendNode = (node: TreeSelectNode, depth: number) => {
    if (visited.has(node.value)) return;
    visited.add(node.value);
    const childNodes = children.get(node.value) ?? [];
    rows.push({ ...node, depth, hasChildren: childNodes.length > 0 });
    if (collapsed.has(node.value)) {
      hideDescendants(node.value);
      return;
    }
    for (const child of childNodes) appendNode(child, depth + 1);
  };

  for (const node of children.get(null) ?? []) appendNode(node, 0);
  for (const node of byValue.values()) {
    if (!visited.has(node.value)) appendNode(node, 0);
  }
  return rows;
}
