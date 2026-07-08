import { describe, expect, it } from "vitest";

import { parseQuickConnect } from "./quick-connect";

describe("parseQuickConnect", () => {
  it("parses user@host with the default port", () => {
    expect(parseQuickConnect("root@example.com")).toEqual({
      username: "root",
      host: "example.com",
      port: 22,
    });
  });

  it("parses an explicit port", () => {
    expect(parseQuickConnect("deploy@10.0.0.1:2222")).toEqual({
      username: "deploy",
      host: "10.0.0.1",
      port: 2222,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseQuickConnect("  ada@host  ")).toEqual({
      username: "ada",
      host: "host",
      port: 22,
    });
  });

  it("rejects input without a user", () => {
    expect(parseQuickConnect("example.com")).toBeNull();
    expect(parseQuickConnect("@example.com")).toBeNull();
  });

  it("rejects an empty host", () => {
    expect(parseQuickConnect("root@")).toBeNull();
  });

  it("rejects out-of-range ports", () => {
    expect(parseQuickConnect("root@host:0")).toBeNull();
    expect(parseQuickConnect("root@host:70000")).toBeNull();
  });

  it("rejects extra separators", () => {
    expect(parseQuickConnect("a@b@c")).toBeNull();
    expect(parseQuickConnect("root@host with space")).toBeNull();
  });
});
