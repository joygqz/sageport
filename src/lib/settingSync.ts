import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";

interface SettingQueryData {
  value: string | null;
  revision: number;
}

export function cacheSettingValue(key: string, value: string): void {
  const queryKey = ["settings", key] as const;
  const current = queryClient.getQueryData<SettingQueryData>(queryKey);
  queryClient.setQueryData<SettingQueryData>(queryKey, {
    value,
    revision: current?.revision ?? 0,
  });
}

interface SettingSyncOptions {
  onLoadError?: (error: unknown) => void;
  onSaveError?: (error: unknown) => void;
}

export function useSettingSync(
  key: string,
  current: string,
  onRemote: (value: string) => void,
  options: SettingSyncOptions = {},
) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["settings", key] as const, [key]);
  const revisionRef = useRef(0);
  const currentRef = useRef(current);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const callbacksRef = useRef({ onRemote, ...options });

  useEffect(() => {
    currentRef.current = current;
    callbacksRef.current = { onRemote, ...options };
  }, [current, onRemote, options]);

  const enqueueWrite = useCallback(
    (value: string) => {
      const write = writeChainRef.current
        .catch(() => undefined)
        .then(() => ipc.settings.set(key, value));
      writeChainRef.current = write;
      void write.catch((error) => callbacksRef.current.onSaveError?.(error));
    },
    [key],
  );

  const { data, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<SettingQueryData> => {
      const revision = revisionRef.current;
      return { value: await ipc.settings.get(key), revision };
    },
  });

  useEffect(() => {
    if (error) callbacksRef.current.onLoadError?.(error);
  }, [error]);

  useEffect(() => {
    if (data === undefined) return;

    if (data.revision !== revisionRef.current) {
      qc.setQueryData<SettingQueryData>(queryKey, {
        value: currentRef.current,
        revision: revisionRef.current,
      });
      return;
    }

    if (data.value === null) {
      qc.setQueryData<SettingQueryData>(queryKey, {
        value: currentRef.current,
        revision: revisionRef.current,
      });
      enqueueWrite(currentRef.current);
      return;
    }

    if (data.value !== currentRef.current) {
      callbacksRef.current.onRemote(data.value);
    }
  }, [data, enqueueWrite, qc, queryKey]);

  return useCallback(
    (value: string) => {
      const cached = qc.getQueryData<SettingQueryData>(queryKey);
      if (cached?.value === value) return;

      revisionRef.current += 1;
      currentRef.current = value;
      qc.setQueryData<SettingQueryData>(queryKey, {
        value,
        revision: revisionRef.current,
      });
      enqueueWrite(value);
    },
    [enqueueWrite, qc, queryKey],
  );
}
