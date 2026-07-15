import { describe, expect, it } from "vitest";

import { formatQuickConnectTarget, parseQuickConnect } from "./quick-connect";

describe("parseQuickConnect", () => {
  it("parses user@host", () => {
    expect(parseQuickConnect("root@example.com")).toEqual({
      username: "root",
      host: "example.com",
      port: 22,
    });
  });

  it("parses user@host:port", () => {
    expect(parseQuickConnect("deploy@10.0.0.5:2222")).toEqual({
      username: "deploy",
      host: "10.0.0.5",
      port: 2222,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseQuickConnect("  admin@server  ")).toEqual({
      username: "admin",
      host: "server",
      port: 22,
    });
  });

  it("parses bracketed and unbracketed IPv6 addresses", () => {
    expect(parseQuickConnect("root@[2001:db8::1]:2222")).toEqual({
      username: "root",
      host: "2001:db8::1",
      port: 2222,
    });
    expect(parseQuickConnect("root@2001:db8::1")).toEqual({
      username: "root",
      host: "2001:db8::1",
      port: 22,
    });
  });

  it("formats IPv6 targets without an ambiguous port", () => {
    expect(
      formatQuickConnectTarget({
        username: "root",
        host: "2001:db8::1",
        port: 2222,
      }),
    ).toBe("root@[2001:db8::1]:2222");
  });

  it("rejects invalid input", () => {
    expect(parseQuickConnect("")).toBeNull();
    expect(parseQuickConnect("example.com")).toBeNull();
    expect(parseQuickConnect("a@b@c")).toBeNull();
    expect(parseQuickConnect("user@host:0")).toBeNull();
    expect(parseQuickConnect("user@host:70000")).toBeNull();
    expect(parseQuickConnect("user name@host")).toBeNull();
    expect(parseQuickConnect("user@[2001:db8::1")).toBeNull();
    expect(parseQuickConnect("user@host:not-a-port")).toBeNull();
    expect(parseQuickConnect("user@host:")).toBeNull();
  });
});
