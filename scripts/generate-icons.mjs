#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.argv[2] ?? join(root, "scripts", "logo.svg");
const outDir = join(root, "src-tauri", "icons");
const SIZE = 1024;

const log = (msg) => console.log(`\x1b[32m▸\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

if (!existsSync(source)) fail(`source not found: ${source}`);
log(`source: ${source}`);

const isSvg = source.toLowerCase().endsWith(".svg");
let pngPath = source;
let tmp;

if (isSvg) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    sharp = null;
  }

  if (sharp) {
    tmp = mkdtempSync(join(tmpdir(), "sageport-icon-"));
    pngPath = join(tmp, "app-icon.png");
    await sharp(readFileSync(source), { density: 384 })
      .resize(SIZE, SIZE, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(pngPath);
    log(`rasterized → ${SIZE}×${SIZE} PNG (sharp)`);
  } else {
    log("sharp not installed — passing SVG directly to `tauri icon` (resvg)");
  }
}

try {
  execFileSync("pnpm", ["tauri", "icon", pngPath, "--output", outDir], {
    stdio: "inherit",
    cwd: root,
  });

  if (pngPath.toLowerCase().endsWith(".png")) {
    copyFileSync(pngPath, join(root, "public", "app-icon.png"));
    log("copied → public/app-icon.png");
  }
} catch {
  fail("`tauri icon` failed — is @tauri-apps/cli installed?");
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

if (isSvg) {
  writeFileSync(
    join(root, "src", "assets", "app-logo.svg"),
    readFileSync(source, "utf8"),
  );
  log("copied → src/assets/app-logo.svg (title-bar logo)");
}

log(`done → ${outDir}`);
