import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export const autostartQueryKey = ["system", "autostart"] as const;

export async function readAutostart(): Promise<boolean> {
  return isEnabled();
}

export async function writeAutostart(enabled: boolean): Promise<boolean> {
  if (enabled) await enable();
  else await disable();
  return isEnabled();
}
