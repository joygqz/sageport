import type { Host } from "@/types/models";
import type { TerminalPane } from "@/workbench/tabs";

function hostAddress(address: string): string {
  return address.includes(":") && !address.startsWith("[")
    ? `[${address}]`
    : address;
}

export function terminalConnectionTarget(
  pane: TerminalPane,
  host?: Pick<Host, "address" | "port" | "username">,
): string | null {
  const endpoint =
    pane.target === "ssh-adhoc" && pane.adhoc
      ? {
          address: pane.adhoc.host,
          port: pane.adhoc.port,
          username: pane.adhoc.username,
        }
      : host;
  if (!endpoint) return null;

  const login = endpoint.username ? `${endpoint.username}@` : "";
  return `${login}${hostAddress(endpoint.address)}:${endpoint.port}`;
}
