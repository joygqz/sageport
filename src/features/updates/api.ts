import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";
import type { UpdateStatus } from "@/types/models";

/**
 * Live view of the updater. The update lifecycle itself lives in the Rust
 * backend (`update::UpdateManager`) so it survives any UI unmounting
 * mid-download; this hook syncs to the current status on mount and then
 * follows the backend's status events.
 */
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
