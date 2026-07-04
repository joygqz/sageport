import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

/**
 * Bridges a locally-persisted UI setting (localStorage, zustand, ...) with
 * the DB-backed settings table, which is the thing that actually travels in
 * vault sync (see `EXCLUDED_SETTINGS_PREFIXES` in
 * `src-tauri/src/sync/mod.rs` — anything outside `sync.`/`update.` rides
 * along). `current` is the value already active locally; `onRemote` applies
 * an incoming value that differs from it — either a change merged in from
 * another device, or, if the DB has no row yet (fresh install, or a device
 * upgrading from a version that only persisted this setting locally), the
 * local value is seeded into the DB instead so it starts traveling with
 * sync.
 */
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
