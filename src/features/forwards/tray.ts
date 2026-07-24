import type {
  ForwardStatusKind,
  PortForward,
  TrayForwardItem,
} from "@/types/models";
import { describeForward } from "./forwardForm";

/**
 * Build the tray rows for forwards that are currently running — active, or still
 * in the middle of starting — each labeled with its route and sorted by name.
 * `runtime` is the same status map the Forwards view renders from.
 */
export function activeForwardItems(
  forwards: PortForward[],
  runtime: Record<string, { status: ForwardStatusKind }>,
): TrayForwardItem[] {
  return forwards
    .filter((forward) => {
      const status = runtime[forward.id]?.status;
      return status === "active" || status === "starting";
    })
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((forward) => ({
      id: forward.id,
      label: `${forward.label} · ${describeForward(forward)}`,
    }));
}
