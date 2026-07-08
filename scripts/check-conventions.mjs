import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const problems = [];

function tracked(glob) {
  return execSync(`git ls-files ${glob}`, { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const ipcFiles = tracked("'src/**/*.ts' 'src/**/*.tsx'").filter(
  (f) => f !== "src/lib/ipc.ts",
);
for (const file of ipcFiles) {
  const text = readFileSync(root + file, "utf8");
  if (/[^.\w]invoke\s*[<(]/.test(text)) {
    problems.push(`${file}: raw invoke() outside src/lib/ipc.ts`);
  }
}

for (const file of tracked("'src-tauri/src/**/*.rs'")) {
  const text = readFileSync(root + file, "utf8");
  if (/std::sync::Mutex/.test(text)) {
    problems.push(`${file}: use parking_lot::Mutex instead of std::sync::Mutex`);
  }
}

if (problems.length > 0) {
  console.error("Convention check failed:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Conventions OK");
