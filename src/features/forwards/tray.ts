import type {
  ForwardStatusKind,
  PortForward,
  TrayForwardItem,
} from "@/types/models";
import { describeForward } from "./forwardForm";

export function activeForwardItems(
  forwards: PortForward[],
  runtime: Record<string, { status: ForwardStatusKind }>,
): TrayForwardItem[] {
  return forwards
    .filter((forward) => {
      const status = runtime[forward.id]?.status;
      return (
        status === "active" ||
        status === "starting" ||
        status === "reconnecting"
      );
    })
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((forward) => ({
      id: forward.id,
      label: `${forward.label} · ${describeForward(forward)}`,
    }));
}
