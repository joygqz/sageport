import { useEffect } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { useToastStore } from "@/lib/toast";
import { useTabsStore } from "@/workbench/tabs";
import { useUpdateStatus } from "./api";

const notified = new Set<string>();
let availableToastId: string | null = null;

export function useUpdateNotifier() {
  const { t } = useI18n();
  const state = useUpdateStatus();

  useEffect(() => {
    const { push, dismiss } = useToastStore.getState();

    if (
      (state.status === "downloading" || state.status === "ready") &&
      availableToastId
    ) {
      dismiss(availableToastId);
      availableToastId = null;
    }

    if (state.status === "available" && !notified.has(state.version)) {
      notified.add(state.version);
      availableToastId = push({
        kind: "info",
        title: t("settings.about.update.available", {
          version: state.version,
        }),
        persistent: true,
        actions: [
          {
            label: t("settings.about.update.install"),
            onClick: () => void ipc.update.install(),
          },
          {
            label: t("settings.about.update.details"),
            onClick: () => useTabsStore.getState().openSettings("about"),
          },
        ],
      });
    }

    if (state.status === "ready" && !notified.has(`ready:${state.version}`)) {
      notified.add(`ready:${state.version}`);
      push({
        kind: "success",
        title: t("settings.about.update.ready", { version: state.version }),
        persistent: true,
        actions: [
          {
            label: t("settings.about.update.restart"),
            onClick: () => void relaunch(),
          },
        ],
      });
    }
  }, [state, t]);
}
