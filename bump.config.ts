import { defineConfig } from "bumpp";

export default defineConfig({
  files: ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"],
  execute: "cargo check --quiet --manifest-path src-tauri/Cargo.toml",
  all: true,
  tag: true,
});
