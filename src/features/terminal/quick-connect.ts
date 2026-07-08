import type { AdhocTarget } from "@/workbench/tabs";

const PATTERN = /^([^@\s:]+)@([^@\s:]+)(?::(\d{1,5}))?$/;

export function parseQuickConnect(input: string): AdhocTarget | null {
  const match = PATTERN.exec(input.trim());
  if (!match) return null;
  const [, username, host, portText] = match;
  const port = portText ? Number(portText) : 22;
  if (port < 1 || port > 65535) return null;
  return { username, host, port };
}
