import type { AdhocTarget } from "@/workbench/tabs";

const USERNAME_PATTERN = /^[^@\s:]+$/;
const HOST_PATTERN = /^[^@\s[\]]+$/;

export function parseQuickConnect(input: string): AdhocTarget | null {
  const value = input.trim();
  const separator = value.indexOf("@");
  if (separator <= 0 || separator !== value.lastIndexOf("@")) return null;
  const username = value.slice(0, separator);
  let address = value.slice(separator + 1);
  if (!USERNAME_PATTERN.test(username) || !address) return null;

  let host: string;
  let portText: string | undefined;
  if (address.startsWith("[")) {
    const closing = address.indexOf("]");
    if (closing <= 1) return null;
    host = address.slice(1, closing);
    const suffix = address.slice(closing + 1);
    if (suffix) {
      if (!suffix.startsWith(":") || suffix.length === 1) return null;
      portText = suffix.slice(1);
    }
  } else {
    const colonCount = [...address].filter((char) => char === ":").length;
    if (colonCount === 1) {
      const colon = address.lastIndexOf(":");
      portText = address.slice(colon + 1);
      address = address.slice(0, colon);
      if (!portText) return null;
    }
    host = address;
  }
  if (!HOST_PATTERN.test(host) || (portText && !/^\d{1,5}$/.test(portText))) {
    return null;
  }
  const port = portText ? Number(portText) : 22;
  if (port < 1 || port > 65535) return null;
  return { username, host, port };
}

export function formatQuickConnectTarget(target: AdhocTarget): string {
  const host = target.host.includes(":") ? `[${target.host}]` : target.host;
  return `${target.username}@${host}${target.port === 22 ? "" : `:${target.port}`}`;
}
