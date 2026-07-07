import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";
import type { UpdateStatus } from "@/types/models";

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
