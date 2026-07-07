import { platform } from "@tauri-apps/plugin-os";

export const IS_MACOS = platform() === "macos";
