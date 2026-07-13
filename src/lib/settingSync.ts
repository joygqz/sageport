import { useCallback, useEffect, useEffectEvent, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

export function useSettingSync(
  key: string,
  current: string,
  onRemote: (value: string) => void,
) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["settings", key] as const, [key]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => ipc.settings.get(key),
  });
  const applyRemote = useEffectEvent(onRemote);

  useEffect(() => {
    if (data === undefined || data === current) return;
    if (data === null) {
      void ipc.settings.set(key, current).catch(() => {});
      qc.setQueryData(queryKey, current);
      return;
    }
    applyRemote(data);
  }, [data, current, key, qc, queryKey]);

  return useCallback(
    (value: string) => {
      qc.setQueryData(queryKey, value);
      void ipc.settings.set(key, value).catch(() => {});
    },
    [key, qc, queryKey],
  );
}
