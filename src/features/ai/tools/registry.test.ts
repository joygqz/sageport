import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

import {
  AI_TOOL_SPECS,
  ALL_TOOLS,
  TOOL_ICONS,
  TOOL_LABEL_KEYS,
  TOOLS_REQUIRING_APPROVAL,
  getTool,
  prepareTool,
  redactToolArguments,
  validateToolArguments,
} from "./registry";

describe("tool registry", () => {
  it("exposes a spec, icon, and label for every tool with unique names", () => {
    const names = ALL_TOOLS.map((tool) => tool.spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(AI_TOOL_SPECS).toHaveLength(ALL_TOOLS.length);
    for (const name of names) {
      expect(TOOL_ICONS[name]).toBeTruthy();
      expect(TOOL_LABEL_KEYS[name]).toBeTruthy();
    }
  });

  it("keeps the approval set in sync with tool flags and requires an executor", () => {
    for (const tool of ALL_TOOLS) {
      const name = tool.spec.name;
      expect(TOOLS_REQUIRING_APPROVAL.has(name)).toBe(
        Boolean(tool.requiresApproval),
      );
      if (tool.requiresApproval) {
        expect(tool.execute).toBeTypeOf("function");
      }
    }
  });

  it("treats ask_user as a UI-handled tool without an executor or approval", () => {
    const askUser = getTool("ask_user");
    expect(askUser?.execute).toBeUndefined();
    expect(TOOLS_REQUIRING_APPROVAL.has("ask_user")).toBe(false);
  });

  it("returns args unchanged when a tool declares no prepare hook", async () => {
    const prepared = await prepareTool(
      "list_hosts",
      { foo: "bar" },
      { userPrompt: "" },
    );
    expect(prepared).toEqual({ args: { foo: "bar" } });
  });

  it("redacts credential fields without dropping ordinary arguments", () => {
    expect(
      redactToolArguments("update_identity", {
        id: "identity-1",
        username: "root",
        password: "secret",
      }),
    ).toEqual({
      id: "identity-1",
      username: "root",
      password: "[REDACTED]",
    });
  });

  it("validates required fields, enums, and extra properties locally", () => {
    expect(validateToolArguments("delete_host", {})).toContain(
      "id is required",
    );
    expect(
      validateToolArguments("generate_ssh_key", {
        name: "deploy",
        algorithm: "weak-key",
      }),
    ).toContain("must be one of");
    expect(validateToolArguments("list_hosts", { unexpected: true })).toContain(
      "is not allowed",
    );
    expect(
      validateToolArguments("delete_host", { id: "host-1" }),
    ).toBeUndefined();
  });
});
