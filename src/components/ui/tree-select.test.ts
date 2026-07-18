import { describe, expect, it } from "vitest";

import { buildTreeSelectRows, type TreeSelectNode } from "./tree-select-model";

const nodes: TreeSelectNode[] = [
  { value: "prod", label: "Production", parentValue: null },
  { value: "cn", label: "China", parentValue: "prod" },
  { value: "east", label: "East", parentValue: "cn" },
  { value: "dev", label: "Development", parentValue: null },
];

describe("tree select rows", () => {
  it("orders and indents nodes by parent", () => {
    expect(
      buildTreeSelectRows(nodes, new Set()).map(({ value, depth }) => ({
        value,
        depth,
      })),
    ).toEqual([
      { value: "prod", depth: 0 },
      { value: "cn", depth: 1 },
      { value: "east", depth: 2 },
      { value: "dev", depth: 0 },
    ]);
  });

  it("hides descendants of collapsed nodes", () => {
    expect(
      buildTreeSelectRows(nodes, new Set(["prod"])).map((row) => row.value),
    ).toEqual(["prod", "dev"]);
  });
});
