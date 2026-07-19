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
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
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

  const targetHost = values.targetHost.trim();
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
      bindHost: values.bindHost.trim() || "127.0.0.1",
      bindPort,
      targetHost: hasFixedTarget ? targetHost : null,
      targetPort,
      autoStart: values.autoStart,
    },
  };
}
