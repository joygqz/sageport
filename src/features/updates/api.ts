import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";
import { errorMessage } from "@/lib/toast";
import type { UpdateStatus } from "@/types/models";
import { initializeUpdateStatus, probeSelfUpdate } from "./subscription";

export const RELEASES_URL =
  "https://github.com/joygqz/sageport/releases/latest";

let canSelfUpdatePromise: Promise<boolean> | null = null;

function fetchCanSelfUpdate(): Promise<boolean> {
  // A failed capability probe must never expose an install action that the
  // current package may not support (notably deb/rpm builds on Linux).
  canSelfUpdatePromise ??= probeSelfUpdate(ipc.update.canSelfUpdate);
  return canSelfUpdatePromise;
}

export function useCanSelfUpdate(): boolean | null {
  const [canSelfUpdate, setCanSelfUpdate] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCanSelfUpdate().then((value) => {
      if (!cancelled) setCanSelfUpdate(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return canSelfUpdate;
}

export function useUpdateStatus(): UpdateStatus {
  const [state, setState] = useState<UpdateStatus>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void initializeUpdateStatus({
      listen: ipc.update.onStatus,
      read: ipc.update.status,
      apply: setState,
      active: () => !cancelled,
    })
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            operation: "check",
            message: errorMessage(error),
          });
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return state;
}
