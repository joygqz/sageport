import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ErrorState, LoadingState, SwitchField } from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { autostartQueryKey, readAutostart, writeAutostart } from "./autostart";
import { SettingsGroup } from "./SettingsGroup";

export function AutostartSetting() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const portable = useQuery({
    queryKey: ["system", "portable"],
    queryFn: ipc.app.isPortable,
    staleTime: Infinity,
  });
  const state = useQuery({
    queryKey: autostartQueryKey,
    queryFn: readAutostart,
    refetchOnWindowFocus: true,
  });
  const update = useMutation({
    mutationFn: writeAutostart,
    onSuccess: (actual, requested) => {
      queryClient.setQueryData(autostartQueryKey, actual);
      if (actual !== requested) {
        toast.error(t("settings.general.autostart.notApplied"));
      }
    },
    onError: (error) => {
      toast.error(
        t("settings.general.autostart.saveError"),
        errorMessage(error),
      );
      void queryClient.invalidateQueries({ queryKey: autostartQueryKey });
    },
  });

  if (portable.isPending || portable.data) {
    return null;
  }

  return (
    <SettingsGroup title={t("settings.general.startup")}>
      {state.isPending ? (
        <LoadingState label={t("settings.general.autostart.loading")} />
      ) : state.isError ? (
        <ErrorState
          title={t("settings.general.autostart.loadError")}
          retryLabel={t("common.retry")}
          onRetry={() => void state.refetch()}
        />
      ) : (
        <SwitchField
          label={t("settings.general.autostart.label")}
          description={t("settings.general.autostart.description")}
          checked={state.data}
          disabled={update.isPending}
          onCheckedChange={(enabled) => update.mutate(enabled)}
        />
      )}
    </SettingsGroup>
  );
}
