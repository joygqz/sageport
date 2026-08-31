import type { Host } from "@/types/models";

export function filterHosts(hosts: Host[], query: string): Host[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return hosts;
  return hosts.filter((host) =>
    [host.label, host.address, host.username]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}
