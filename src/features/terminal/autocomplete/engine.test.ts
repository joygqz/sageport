import { describe, expect, it } from "vitest";

import { currentInput, extractCommand, suggest } from "./engine";

describe("extractCommand", () => {
  it("strips a shell prompt", () => {
    expect(extractCommand("user@host:~/app$ git status")).toBe("git status");
    expect(extractCommand("root@box:/# systemctl restart nginx")).toBe(
      "systemctl restart nginx",
    );
    expect(extractCommand("me@host:~ % npm test")).toBe("npm test");
  });

  it("returns the trimmed line when no prompt is present", () => {
    expect(extractCommand("  ls -la  ")).toBe("ls -la");
  });

  it("rejects empty or overly long input", () => {
    expect(extractCommand("")).toBeNull();
    expect(extractCommand("   ")).toBeNull();
    expect(extractCommand("$ " + "x".repeat(600))).toBeNull();
  });

  it("rejects a bare prompt with no command", () => {
    expect(extractCommand("user@host:~$ ")).toBeNull();
    expect(extractCommand("user@host:~$")).toBeNull();
    expect(extractCommand("❯ ")).toBeNull();
    expect(extractCommand("me@host:~ %")).toBeNull();
  });
});

describe("currentInput", () => {
  it("returns text after the prompt", () => {
    expect(currentInput("me@host:~$ tail -f ")).toBe("tail -f ");
    expect(currentInput("cat file")).toBe("cat file");
  });
});

describe("suggest", () => {
  it("returns the remainder of the first matching candidate", () => {
    expect(suggest("git ", ["git status", "git commit"])).toBe("status");
    expect(suggest("systemctl re", ["systemctl restart nginx"])).toBe(
      "start nginx",
    );
  });

  it("ignores non-matching or equal candidates", () => {
    expect(suggest("ls", ["ls"])).toBeNull();
    expect(suggest("do", ["git status"])).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(suggest("   ", ["anything"])).toBeNull();
  });

  it("dedupes candidates", () => {
    expect(suggest("np", ["npm test", "npm test"])).toBe("m test");
  });
});
