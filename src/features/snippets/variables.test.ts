import { describe, expect, it } from "vitest";

import { parseVariables, substitute } from "./variables";

describe("parseVariables", () => {
  it("extracts unique variables with defaults", () => {
    const vars = parseVariables("deploy {{env}} --tag {{tag:latest}}");
    expect(vars).toEqual([
      { name: "env", defaultValue: "" },
      { name: "tag", defaultValue: "latest" },
    ]);
  });

  it("dedupes and prefers a non-empty default", () => {
    const vars = parseVariables("{{host}} {{host:web}} {{host}}");
    expect(vars).toEqual([{ name: "host", defaultValue: "web" }]);
  });

  it("returns nothing when there are no variables", () => {
    expect(parseVariables("ls -la")).toEqual([]);
  });

  it("ignores malformed braces", () => {
    expect(parseVariables("echo {not a var} {{ok}}")).toEqual([
      { name: "ok", defaultValue: "" },
    ]);
  });
});

describe("substitute", () => {
  it("replaces variables with provided values", () => {
    expect(
      substitute("scp {{file}} {{host}}:/tmp", { file: "a.txt", host: "web" }),
    ).toBe("scp a.txt web:/tmp");
  });

  it("falls back to defaults when a value is missing or empty", () => {
    expect(substitute("run --tag {{tag:latest}}", {})).toBe("run --tag latest");
    expect(substitute("run --tag {{tag:latest}}", { tag: "" })).toBe(
      "run --tag latest",
    );
    expect(substitute("run --tag {{tag:latest}}", { tag: "   " })).toBe(
      "run --tag latest",
    );
    expect(substitute("run --tag {{tag:latest}}", { tag: "v2" })).toBe(
      "run --tag v2",
    );
  });

  it("leaves an empty string when no value and no default", () => {
    expect(substitute("echo {{x}}", {})).toBe("echo ");
  });

  it("uses one canonical default for repeated variables", () => {
    expect(substitute("{{host}} {{host:web}} {{host}}", { host: "" })).toBe(
      "web web web",
    );
  });
});
