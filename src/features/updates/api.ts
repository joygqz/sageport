import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";
import type { UpdateStatus } from "@/types/models";

export const RELEASES_URL =
  "https://github.com/joygqz/sageport/releases/latest";

let canSelfUpdatePromise: Promise<boolean> | null = null;

function fetchCanSelfUpdate(): Promise<boolean> {
  canSelfUpdatePromise ??= ipc.update.canSelfUpdate().catch(() => true);
  return canSelfUpdatePromise;
}

export function useCanSelfUpdate(): boolean {
  const [canSelfUpdate, setCanSelfUpdate] = useState(true);

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
    void ipc.update.status().then((s) => {
      if (!cancelled) setState(s);
    });
    const unlisten = ipc.update.onStatus((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      void unlisten.then((un) => un());
    };
  }, []);

  return state;
}
