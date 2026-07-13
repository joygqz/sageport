import { describe, expect, it } from "vitest";

import type { TransferEvent } from "@/types/models";
import {
  formatEta,
  pendingTransfer,
  updateTransferProgress,
} from "./transfer-progress";

const event = (transferred: number, total = 1_000): TransferEvent => ({
  transferId: "tx",
  transferred,
  total,
  file: "backup.tar",
  status: "active",
  phase: "transferring",
});

describe("transfer progress", () => {
  it("calculates speed and remaining time from progress samples", () => {
    const pending = pendingTransfer(event(0), "source", "dest", 1_000);
    const active = updateTransferProgress(pending, event(500), 2_000);

    expect(active.speedBps).toBe(500);
    expect(active.etaSeconds).toBe(1);
    expect(active.sourceConnectionId).toBe("source");
    expect(active.destConnectionId).toBe("dest");
  });

  it("does not report a rate while preparing", () => {
    const preparing = updateTransferProgress(undefined, {
      ...event(0, 0),
      phase: "preparing",
    });
    expect(preparing.speedBps).toBe(0);
    expect(preparing.etaSeconds).toBeNull();
  });

  it("formats compact ETAs", () => {
    expect(formatEta(4.1)).toBe("5s");
    expect(formatEta(61)).toBe("2m");
    expect(formatEta(3_900)).toBe("1h 5m");
  });
});
