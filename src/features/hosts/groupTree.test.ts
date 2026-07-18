import { describe, expect, it } from "vitest";

import type { Group } from "@/types/models";
import { descendantGroupIds } from "./groupTree";

function group(id: string, name: string, parentId: string | null): Group {
  return {
    id,
    name,
    parentId,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    revision: 1,
  };
}

describe("group tree helpers", () => {
  const groups = [
    group("prod", "Production", null),
    group("cn", "China", "prod"),
    group("east", "East", "cn"),
    group("dev-cn", "China", "dev"),
    group("dev", "Development", null),
  ];

  it("finds every invalid re-parent target", () => {
    expect([...descendantGroupIds(groups, "prod")]).toEqual([
      "prod",
      "cn",
      "east",
    ]);
  });
});
