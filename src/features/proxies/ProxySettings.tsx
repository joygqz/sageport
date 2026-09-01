import { useState } from "react";
import { Check, Pencil, Plus, Route, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorDescription, errorMessage, toast } from "@/lib/toast";
import type { ProxyProfile } from "@/types/models";
import { cn } from "@/lib/utils";
import {
  SettingsGroup,
  SETTINGS_GROUP_STACK_CLASS,
} from "@/features/settings/SettingsGroup";
import { useDeleteProxy, useProxyState, useSetActiveProxy } from "./api";
import { ProxyFormDialog } from "./ProxyFormDialog";

export function ProxySettings() {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useProxyState();
  const setActive = useSetActiveProxy();
  const deleteProxy = useDeleteProxy();
  const [form, setForm] = useState<{
    open: boolean;
    profile: ProxyProfile | null;
  }>({ open: false, profile: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const activate = async (id: string | null) => {
    try {
      await setActive.mutateAsync(id);
    } catch (error) {
      toast.error(t("settings.proxy.switchError"), errorMessage(error));
    }
  };

  const requestDelete = (profile: ProxyProfile) => {
    setConfirmState({
      title: t("settings.proxy.delete.title", { name: profile.name }),
      description: t("settings.proxy.delete.description"),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("settings.proxy.delete.action"),
          variant: "destructive",
          onSelect: () =>
            void deleteProxy.mutateAsync(profile.id).catch((error) => {
              toast.error(
                t("settings.proxy.delete.error"),
                errorDescription(error),
              );
            }),
        },
      ],
    });
  };

  return (
    <div className={SETTINGS_GROUP_STACK_CLASS}>
      <SettingsGroup
        title={t("settings.proxy.title")}
        description={t("settings.proxy.description")}
        actions={
          <Button
            size="sm"
            onClick={() => setForm({ open: true, profile: null })}
          >
            <Plus /> {t("settings.proxy.add")}
          </Button>
        }
      >
        {isLoading ? (
          <LoadingState label={t("common.loading")} />
        ) : isError || !data ? (
          <ErrorState
            title={t("settings.proxy.loadError")}
            retryLabel={t("common.retry")}
            onRetry={() => void refetch()}
          />
        ) : data.profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("settings.proxy.empty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
            {data.profiles.map((profile) => {
              const active = profile.id === data.activeProxyId;
              return (
                <div
                  key={profile.id}
                  className="flex min-w-0 items-center gap-3 border-b border-border-subtle px-3 py-2.5 last:border-b-0"
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-md",
                      active
                        ? "bg-primary/15 text-link"
                        : "bg-surface-sunken text-muted-foreground",
                    )}
                  >
                    {active ? (
                      <Check className="size-4" />
                    ) : (
                      <Route className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {profile.name}
                      </span>
                      <Badge variant={active ? "primary" : "default"}>
                        {t(`settings.proxy.kind.${profile.kind}`)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {profile.username ? `${profile.username}@` : ""}
                      {profile.host}:{profile.port}
                    </p>
                  </div>
                  {!active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => void activate(profile.id)}
                    >
                      {t("settings.proxy.use")}
                    </Button>
                  )}
                  {active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => void activate(null)}
                    >
                      {t("settings.proxy.disable")}
                    </Button>
                  )}
                  <Tooltip content={t("settings.proxy.edit")}>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("settings.proxy.editNamed", {
                        name: profile.name,
                      })}
                      onClick={() => setForm({ open: true, profile })}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={t("settings.proxy.delete.action")}>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("settings.proxy.deleteNamed", {
                        name: profile.name,
                      })}
                      onClick={() => requestDelete(profile)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}
      </SettingsGroup>

      <ProxyFormDialog
        open={form.open}
        profile={form.profile}
        onClose={() => setForm((current) => ({ ...current, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
