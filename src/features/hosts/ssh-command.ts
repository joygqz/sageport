import type { Host } from "@/types/models";

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function formatSshCommand(
  host: Pick<Host, "address" | "port" | "username">,
): string {
  const destination = host.username
    ? `${host.username}@${host.address}`
    : host.address;
  const port = host.port === 22 ? "" : ` -p ${host.port}`;
  return `ssh${port} ${shellQuote(destination)}`;
}
