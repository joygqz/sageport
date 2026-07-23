import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);
const initialAssets = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="\/(assets\/[^"?]+\.js)"/g)].map(
      (match) => match[1],
    ),
  ),
];

const INITIAL_JS_BUDGET = 525 * 1024;
const lazyOnlyPrefixes = [
  "AssistantPanel-",
  "CommandPalette-",
  "FileEditor-",
  "GroupFormDialog-",
  "HostBrandIcon-",
  "HostFormDialog-",
  "HostKeyDialog-",
  "HostsView-",
  "PasswordPromptDialog-",
  "SettingsPage-",
  "SshConfigImportDialog-",
  "TerminalEditor-",
  "notifier-",
  "confirm-dialog-",
  "dialog-",
  "index.esm-",
  "markdown-",
  "toaster-",
  "xterm-",
];

const accidentallyEager = initialAssets.filter((asset) =>
  lazyOnlyPrefixes.some((prefix) =>
    asset.split("/").at(-1)?.startsWith(prefix),
  ),
);

const rawBytes = initialAssets.reduce(
  (total, asset) => total + statSync(`${root}dist/${asset}`).size,
  0,
);
const gzipBytes = initialAssets.reduce(
  (total, asset) =>
    total + gzipSync(readFileSync(`${root}dist/${asset}`)).byteLength,
  0,
);

if (accidentallyEager.length > 0) {
  throw new Error(
    `Lazy feature bundles leaked into the initial load: ${accidentallyEager.join(", ")}`,
  );
}

if (rawBytes > INITIAL_JS_BUDGET) {
  throw new Error(
    `Initial JS is ${(rawBytes / 1024).toFixed(1)} kB, exceeding the ${INITIAL_JS_BUDGET / 1024} kB budget`,
  );
}

console.log(
  `Initial JS: ${(rawBytes / 1024).toFixed(1)} kB raw / ${(gzipBytes / 1024).toFixed(1)} kB gzip (${initialAssets.length} files)`,
);
