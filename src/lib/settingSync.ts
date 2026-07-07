import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

export function useSettingSync(
  key: string,
  current: string,
  onRemote: (value: string) => void,
) {
  const qc = useQueryClient();
  const queryKey = ["settings", key];

  const { data } = useQuery({
    queryKey,
    queryFn: () => ipc.settings.get(key),
  });

  useEffect(() => {
    if (data === undefined || data === current) return;
    if (data === null) {
      void ipc.settings.set(key, current).catch(() => {});
      qc.setQueryData(queryKey, current);
      return;
    }
    onRemote(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, current]);

  return useCallback(
    (value: string) => {
      qc.setQueryData(queryKey, value);
      void ipc.settings.set(key, value).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, qc],
  );
}
