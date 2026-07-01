#!/usr/bin/env node
/**
 * Sageport — one-command icon generator.
 *
 *   pnpm icon            # regenerate every platform icon from scripts/logo.svg
 *   pnpm icon path.svg   # use a different source file
 *
 * Pipeline:
 *   master SVG  →  1024×1024 PNG  →  `tauri icon`  →  src-tauri/icons/*
 *
 * The single source of truth is scripts/logo.svg. Edit that, run this, done.
 * `tauri icon` fans the source out into .icns (macOS), .ico (Windows),
 * the Square*Logo.png set (Windows Store) and every PNG size Tauri bundles.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = process.argv[2] ?? join(root, 'scripts', 'logo.svg');
const outDir = join(root, 'src-tauri', 'icons');
const SIZE = 1024;

const log = (msg) => console.log(`\x1b[32m▸\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

if (!existsSync(source)) fail(`source not found: ${source}`);
log(`source: ${source}`);

const isSvg = source.toLowerCase().endsWith('.svg');
let pngPath = source;
let tmp;

// `tauri icon` wants a square PNG (ideally 1024×1024, transparent). When the
// source is an SVG we rasterize it first. Prefer `sharp` if installed for a
// crisp, predictable render; otherwise fall back to passing the SVG straight
// to `tauri icon`, which rasterizes via resvg.
if (isSvg) {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    sharp = null;
  }

  if (sharp) {
    tmp = mkdtempSync(join(tmpdir(), 'sageport-icon-'));
    pngPath = join(tmp, 'app-icon.png');
    await sharp(readFileSync(source), { density: 384 })
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(pngPath);
    log(`rasterized → ${SIZE}×${SIZE} PNG (sharp)`);
  } else {
    log('sharp not installed — passing SVG directly to `tauri icon` (resvg)');
  }
}

try {
  execFileSync(
    'pnpm',
    ['tauri', 'icon', pngPath, '--output', outDir],
    { stdio: 'inherit', cwd: root },
  );
} catch {
  fail('`tauri icon` failed — is @tauri-apps/cli installed?');
} finally {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

log(`done → ${outDir}`);
