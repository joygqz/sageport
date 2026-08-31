import { describe, expect, it } from "vitest";

import type { Host } from "@/types/models";
import { filterHosts } from "./host-search";

function host(label: string, address: string, username: string | null): Host {
  return {
    id: label,
    label,
    address,
    port: 22,
    groupId: null,
    identityId: null,
    username,
    authType: null,
    keyId: null,
    osHint: null,
    notes: null,
    jumpHostId: null,
    startupCommand: null,
    hasPassword: false,
    lastUsedAt: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    revision: 1,
  };
}

describe("file panel host search", () => {
  const hosts = [
    host("Production", "10.0.0.10", "deploy"),
    host("Staging", "staging.example.com", "ubuntu"),
  ];

  it("matches labels, addresses, and usernames without case sensitivity", () => {
    expect(filterHosts(hosts, "prod")).toEqual([hosts[0]]);
    expect(filterHosts(hosts, "EXAMPLE")).toEqual([hosts[1]]);
    expect(filterHosts(hosts, "DEPLOY")).toEqual([hosts[0]]);
  });

  it("returns all hosts for an empty query", () => {
    expect(filterHosts(hosts, "  ")).toBe(hosts);
  });
});
