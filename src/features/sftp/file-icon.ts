export type FileIconKind =
  | "archive"
  | "audio"
  | "code"
  | "config"
  | "database"
  | "image"
  | "key"
  | "package"
  | "spreadsheet"
  | "text"
  | "video"
  | "file";

const EXTENSION_GROUPS: ReadonlyArray<
  readonly [FileIconKind, ReadonlySet<string>]
> = [
  [
    "image",
    new Set([
      "avif",
      "bmp",
      "gif",
      "heic",
      "ico",
      "jpeg",
      "jpg",
      "png",
      "svg",
      "tif",
      "tiff",
      "webp",
    ]),
  ],
  [
    "audio",
    new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]),
  ],
  [
    "video",
    new Set(["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm"]),
  ],
  [
    "archive",
    new Set([
      "7z",
      "bz2",
      "dmg",
      "gz",
      "iso",
      "rar",
      "tar",
      "tgz",
      "xz",
      "zip",
      "zst",
    ]),
  ],
  ["spreadsheet", new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsx"])],
  ["database", new Set(["db", "db3", "mdb", "sqlite", "sqlite3"])],
  ["key", new Set(["cer", "crt", "der", "key", "p12", "pem", "pfx", "pub"])],
  [
    "config",
    new Set([
      "conf",
      "config",
      "env",
      "ini",
      "json",
      "properties",
      "toml",
      "xml",
      "yaml",
      "yml",
    ]),
  ],
  [
    "code",
    new Set([
      "c",
      "cc",
      "cpp",
      "cs",
      "css",
      "dart",
      "ex",
      "exs",
      "go",
      "h",
      "hpp",
      "html",
      "java",
      "js",
      "jsx",
      "kt",
      "kts",
      "lua",
      "php",
      "py",
      "rb",
      "rs",
      "sass",
      "scala",
      "scss",
      "sh",
      "sql",
      "swift",
      "ts",
      "tsx",
      "vue",
      "wasm",
    ]),
  ],
  ["text", new Set(["log", "md", "mdx", "pdf", "rtf", "text", "txt"])],
];

const PACKAGE_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "cargo.toml",
  "composer.json",
  "composer.lock",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pyproject.toml",
  "yarn.lock",
]);

const CONFIG_FILES = new Set([
  ".editorconfig",
  ".env",
  ".gitattributes",
  ".gitconfig",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
  ".zshrc",
  "dockerfile",
  "makefile",
]);

export function fileIconKind(name: string): FileIconKind {
  const lowerName = name.toLowerCase();
  if (PACKAGE_FILES.has(lowerName)) return "package";
  if (CONFIG_FILES.has(lowerName) || lowerName.startsWith(".env.")) {
    return "config";
  }

  const lastDot = lowerName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === lowerName.length - 1) return "file";
  const extension = lowerName.slice(lastDot + 1);

  for (const [kind, extensions] of EXTENSION_GROUPS) {
    if (extensions.has(extension)) return kind;
  }
  return "file";
}
