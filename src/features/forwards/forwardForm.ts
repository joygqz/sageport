import type { ForwardKind, PortForwardInput } from "@/types/models";

export function formatForwardEndpoint(host: string, port: number): string {
  const displayHost =
    host.includes(":") && !(host.startsWith("[") && host.endsWith("]"))
      ? `[${host}]`
      : host;
  return `${displayHost}:${port}`;
}

export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function normalizeForwardHost(host: string): string {
  const value = host.trim();
  return value.startsWith("[") && value.endsWith("]") && value.includes(":")
    ? value.slice(1, -1)
    : value;
}

export type ForwardFormError =
  "required" | "invalidBindPort" | "targetRequired" | "invalidTargetPort";

interface ForwardFormValues {
  hostId: string;
  label: string;
  kind: ForwardKind;
  bindHost: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
  autoStart: boolean;
}

function port(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65535
    ? parsed
    : null;
}

export function forwardInput(
  values: ForwardFormValues,
): { input: PortForwardInput; error?: never } | { error: ForwardFormError } {
  const label = values.label.trim();
  const hostId = values.hostId.trim();
  if (!label || !hostId) return { error: "required" };

  const bindPort = port(values.bindPort);
  if (bindPort === null) return { error: "invalidBindPort" };

  const targetHost = normalizeForwardHost(values.targetHost);
  const hasFixedTarget = values.kind !== "dynamic";
  if (hasFixedTarget && !targetHost) {
    return { error: "targetRequired" };
  }
  const targetPort = hasFixedTarget ? port(values.targetPort) : null;
  if (hasFixedTarget && targetPort === null) {
    return { error: "invalidTargetPort" };
  }

  return {
    input: {
      hostId,
      label,
      kind: values.kind,
      bindHost: normalizeForwardHost(values.bindHost) || "127.0.0.1",
      bindPort,
      targetHost: hasFixedTarget ? targetHost : null,
      targetPort,
      autoStart: values.autoStart,
    },
  };
}
