#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = process.argv[2] ?? join(root, "scripts", "logo.svg");
const outDir = join(root, "src-tauri", "icons");

const GLYPH_VIEWBOX = "212 212 600 600";
const TRAY_SIZE = 32;
const MACOS_TRAY_SIZE = 36;
const PUBLIC_LOGO_SIZE = 256;

const log = (msg) => console.log(`\x1b[32m▸\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

if (!existsSync(source)) fail(`source not found: ${source}`);
if (!source.toLowerCase().endsWith(".svg"))
  fail(`source must be an SVG: ${source}`);
log(`source: ${source}`);

const fullSvg = readFileSync(source, "utf8");
const glyphSvg = toGlyphSvg(fullSvg);
const templateSvg = glyphSvg.replace(/#[0-9a-fA-F]{3,8}\b/g, "#000000");

function toGlyphSvg(svg) {
  const withoutBg = svg.replace(/[ \t]*<[^>]*\bid="bg"[^>]*>\n?/, "");
  if (withoutBg === svg) fail(`no element with id="bg" in ${source}`);
  const size = GLYPH_VIEWBOX.split(" ")[2];
  return withoutBg.replace(
    /<svg\b[^>]*>/,
    `<svg width="${size}" height="${size}" viewBox="${GLYPH_VIEWBOX}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
  );
}

const tmp = mkdtempSync(join(tmpdir(), "sageport-icon-"));

const rasterize = (svg, name, size) => {
  const svgPath = join(tmp, `${name}.svg`);
  const pngDir = join(tmp, name);
  writeFileSync(svgPath, svg);
  execFileSync(
    "pnpm",
    ["tauri", "icon", svgPath, "--output", pngDir, "--png", String(size)],
    { stdio: "inherit", cwd: root },
  );
  return join(pngDir, `${size}x${size}.png`);
};

try {
  execFileSync("pnpm", ["tauri", "icon", source, "--output", outDir], {
    stdio: "inherit",
    cwd: root,
  });

  copyFileSync(
    rasterize(glyphSvg, "tray", TRAY_SIZE),
    join(outDir, "tray-icon.png"),
  );
  log(`glyph ${TRAY_SIZE}×${TRAY_SIZE} → src-tauri/icons/tray-icon.png`);

  copyFileSync(
    rasterize(templateSvg, "tray-template", MACOS_TRAY_SIZE),
    join(outDir, "tray-icon-template.png"),
  );
  log(
    `black glyph ${MACOS_TRAY_SIZE}×${MACOS_TRAY_SIZE} → src-tauri/icons/tray-icon-template.png (macOS template)`,
  );

  copyFileSync(
    rasterize(glyphSvg, "public-logo", PUBLIC_LOGO_SIZE),
    join(root, "public", "app-icon.png"),
  );
  log(
    `glyph ${PUBLIC_LOGO_SIZE}×${PUBLIC_LOGO_SIZE} → public/app-icon.png (about page, README)`,
  );
} catch {
  fail("`tauri icon` failed — is @tauri-apps/cli installed?");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(root, "src", "assets", "app-logo.svg"), glyphSvg);
log("glyph SVG → src/assets/app-logo.svg (title-bar logo)");

log(`done → ${outDir}`);
