import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function versionMismatch(file, expected, actual) {
  return new Error(`${file}: expected version ${expected}, found ${actual}`);
}

export function updateJsonVersion(contents, currentVersion, newVersion, file) {
  const manifest = JSON.parse(contents);
  if (manifest.version !== currentVersion) {
    throw versionMismatch(file, currentVersion, String(manifest.version));
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const matches = lines.flatMap((line, index) => {
    const match = line.match(/^(\s*"version"\s*:\s*")([^"]+)(".*)$/);
    return match ? [{ index, match, indentation: match[1].length }] : [];
  });
  const topLevelIndentation = Math.min(
    ...matches.map(({ indentation }) => indentation),
  );
  const topLevelMatches = matches.filter(
    ({ indentation }) => indentation === topLevelIndentation,
  );

  if (topLevelMatches.length !== 1) {
    throw new Error(`${file}: top-level version not found or is ambiguous`);
  }

  const [{ index, match }] = topLevelMatches;
  if (match[2] !== currentVersion) {
    throw versionMismatch(file, currentVersion, match[2]);
  }
  lines[index] = `${match[1]}${newVersion}${match[3]}`;
  return lines.join(newline);
}

export function updateCargoPackageVersion(
  contents,
  currentVersion,
  newVersion,
) {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  let section = "";
  let versionLine = -1;

  for (const [index, line] of lines.entries()) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    if (section !== "package") continue;
    const versionMatch = line.match(/^(\s*version\s*=\s*")([^"]+)(".*)$/);
    if (!versionMatch) continue;
    if (versionLine !== -1) {
      throw new Error("src-tauri/Cargo.toml: duplicate package version");
    }
    if (versionMatch[2] !== currentVersion) {
      throw versionMismatch(
        "src-tauri/Cargo.toml",
        currentVersion,
        versionMatch[2],
      );
    }

    versionLine = index;
    lines[index] = `${versionMatch[1]}${newVersion}${versionMatch[3]}`;
  }

  if (versionLine === -1) {
    throw new Error("src-tauri/Cargo.toml: package version not found");
  }

  return lines.join(newline);
}

export function updateCargoLockVersion(contents, currentVersion, newVersion) {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  const packageStarts = lines.flatMap((line, index) =>
    line.trim() === "[[package]]" ? [index] : [],
  );
  let sageportPackage = -1;

  for (const [packageIndex, start] of packageStarts.entries()) {
    const end = packageStarts[packageIndex + 1] ?? lines.length;
    const nameLine = lines
      .slice(start + 1, end)
      .find((line) => /^name\s*=/.test(line));
    if (nameLine !== 'name = "sageport"') continue;
    if (sageportPackage !== -1) {
      throw new Error("src-tauri/Cargo.lock: duplicate sageport package");
    }

    const versionIndex = lines
      .slice(start + 1, end)
      .findIndex((line) => /^version\s*=/.test(line));
    if (versionIndex === -1) {
      throw new Error("src-tauri/Cargo.lock: sageport version not found");
    }

    const absoluteVersionIndex = start + 1 + versionIndex;
    const versionMatch = lines[absoluteVersionIndex].match(
      /^(version\s*=\s*")([^"]+)(".*)$/,
    );
    if (!versionMatch) {
      throw new Error("src-tauri/Cargo.lock: invalid sageport version");
    }
    if (versionMatch[2] !== currentVersion) {
      throw versionMismatch(
        "src-tauri/Cargo.lock",
        currentVersion,
        versionMatch[2],
      );
    }

    sageportPackage = start;
    lines[absoluteVersionIndex] =
      `${versionMatch[1]}${newVersion}${versionMatch[3]}`;
  }

  if (sageportPackage === -1) {
    throw new Error("src-tauri/Cargo.lock: sageport package not found");
  }

  return lines.join(newline);
}

export function syncAppVersion({ root, currentVersion, newVersion }) {
  const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
  const cargoManifestPath = resolve(root, "src-tauri/Cargo.toml");
  const cargoLockPath = resolve(root, "src-tauri/Cargo.lock");
  const tauriConfig = updateJsonVersion(
    readFileSync(tauriConfigPath, "utf8"),
    currentVersion,
    newVersion,
    "src-tauri/tauri.conf.json",
  );
  const cargoManifest = updateCargoPackageVersion(
    readFileSync(cargoManifestPath, "utf8"),
    currentVersion,
    newVersion,
  );
  const cargoLock = updateCargoLockVersion(
    readFileSync(cargoLockPath, "utf8"),
    currentVersion,
    newVersion,
  );

  writeFileSync(tauriConfigPath, tauriConfig);
  writeFileSync(cargoManifestPath, cargoManifest);
  writeFileSync(cargoLockPath, cargoLock);
  return [tauriConfigPath, cargoManifestPath, cargoLockPath];
}
