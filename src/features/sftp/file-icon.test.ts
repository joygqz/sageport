import { describe, expect, it } from "vitest";

import { fileIconKind } from "./file-icon";

describe("fileIconKind", () => {
  it.each([
    ["photo.PNG", "image"],
    ["recording.mp3", "audio"],
    ["movie.webm", "video"],
    ["backup.tar.gz", "archive"],
    ["report.xlsx", "spreadsheet"],
    ["data.sqlite3", "database"],
    ["server.pem", "key"],
    ["settings.yaml", "config"],
    ["component.tsx", "code"],
    ["readme.md", "text"],
    ["package.json", "package"],
  ] as const)("classifies %s as %s", (name, kind) => {
    expect(fileIconKind(name)).toBe(kind);
  });

  it("recognizes extensionless and environment config files", () => {
    expect(fileIconKind("Dockerfile")).toBe("config");
    expect(fileIconKind(".env.production")).toBe("config");
  });

  it("falls back for unknown and extensionless files", () => {
    expect(fileIconKind("LICENSE")).toBe("file");
    expect(fileIconKind("document.unknown")).toBe("file");
  });
});
