import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const problems = [];

const packageJson = JSON.parse(readFileSync(root + "package.json", "utf8"));
const tauriConfig = JSON.parse(
  readFileSync(root + "src-tauri/tauri.conf.json", "utf8"),
);
const cargoToml = readFileSync(root + "src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(
  /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
)?.[1];
const versions = new Map([
  ["package.json", packageJson.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoVersion],
]);
for (const [file, version] of versions) {
  if (version !== packageJson.version) {
    problems.push(
      `${file}: version ${String(version)} does not match package.json ${packageJson.version}`,
    );
  }
}

const releaseTag = process.env.SAGEPORT_RELEASE_TAG;
if (releaseTag && releaseTag !== `v${packageJson.version}`) {
  problems.push(
    `release tag ${releaseTag} does not match application version v${packageJson.version}`,
  );
}

function tracked(glob) {
  return execSync(`git ls-files ${glob}`, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const sourceFiles = tracked("'src/**/*.ts' 'src/**/*.tsx'");
const ipcFiles = sourceFiles.filter((f) => f !== "src/lib/ipc.ts");
for (const file of ipcFiles) {
  const text = readFileSync(root + file, "utf8");
  if (/[^.\w]invoke\s*[<(]/.test(text)) {
    problems.push(`${file}: raw invoke() outside src/lib/ipc.ts`);
  }
}

for (const file of sourceFiles.filter((file) => file.endsWith(".tsx"))) {
  const text = readFileSync(root + file, "utf8");
  if (/<(?:select|option)\b/.test(text)) {
    problems.push(
      `${file}: use the shared Select component instead of native select/option elements`,
    );
  }
  if (/role=["'](?:alertdialog|radio|radiogroup|tab|tablist)["']/.test(text)) {
    problems.push(
      `${file}: use the shared Radix primitive instead of hand-written composite widget roles`,
    );
  }
}

for (const file of tracked("'src-tauri/src/**/*.rs'")) {
  const text = readFileSync(root + file, "utf8");
  if (/std::sync::Mutex/.test(text)) {
    problems.push(
      `${file}: use parking_lot::Mutex instead of std::sync::Mutex`,
    );
  }
}

if (problems.length > 0) {
  console.error("Convention check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Conventions OK");
