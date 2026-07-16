import { describe, expect, it } from "vitest";

import { formatSshCommand } from "./ssh-command";

describe("formatSshCommand", () => {
  it("formats the common username and default-port case compactly", () => {
    expect(
      formatSshCommand({
        address: "example.com",
        port: 22,
        username: "deploy",
      }),
    ).toBe("ssh deploy@example.com");
  });

  it("includes a non-default port and supports a missing username", () => {
    expect(
      formatSshCommand({ address: "10.0.0.8", port: 2222, username: null }),
    ).toBe("ssh -p 2222 10.0.0.8");
  });

  it("quotes unusual destinations so the copied command is shell-safe", () => {
    expect(
      formatSshCommand({
        address: "server's lab",
        port: 22,
        username: "ops",
      }),
    ).toBe(`ssh 'ops@server'"'"'s lab'`);
  });
});
