import { describe, expect, it, vi } from "vitest";

import type { UpdateStatus } from "@/types/models";
import { initializeUpdateStatus, probeSelfUpdate } from "./subscription";

describe("update status subscription", () => {
  it("does not replace a newer event with an in-flight snapshot", async () => {
    let handler: ((status: UpdateStatus) => void) | undefined;
    let resolveSnapshot: ((status: UpdateStatus) => void) | undefined;
    const applied: UpdateStatus[] = [];
    const snapshot = new Promise<UpdateStatus>((resolve) => {
      resolveSnapshot = resolve;
    });

    const initialized = initializeUpdateStatus({
      listen: async (next) => {
        handler = next;
        return () => {};
      },
      read: () => snapshot,
      apply: (status) => applied.push(status),
      active: () => true,
    });

    await vi.waitFor(() => expect(handler).toBeDefined());
    handler?.({ status: "available", version: "2.2.0", body: null });
    resolveSnapshot?.({ status: "checking" });
    await initialized;

    expect(applied).toEqual([
      { status: "available", version: "2.2.0", body: null },
    ]);
  });

  it("unlistens and skips the snapshot after cancellation", async () => {
    let active = true;
    const unlisten = vi.fn();
    const read = vi.fn<() => Promise<UpdateStatus>>();
    const listen = async () => {
      active = false;
      return unlisten;
    };

    await initializeUpdateStatus({
      listen,
      read,
      apply: vi.fn(),
      active: () => active,
    });

    expect(unlisten).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("treats a failed capability probe as unsupported", async () => {
    await expect(
      probeSelfUpdate(async () => {
        throw new Error("IPC unavailable");
      }),
    ).resolves.toBe(false);
  });
});
