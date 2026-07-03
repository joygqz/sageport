import { platform } from "@tauri-apps/plugin-os";

/**
 * macOS gets native inset traffic lights (see `openWindow` in `windows.ts`
 * and `tauri.macos.conf.json`), so every custom window chrome reserves space
 * for them and skips its own min/maximize/close buttons. Every other
 * platform gets `decorations: false` and draws its own via `WindowControls`.
 */
export const IS_MACOS = platform() === "macos";
