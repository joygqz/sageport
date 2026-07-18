import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";

import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast, useToastStore } from "@/lib/toast";
import { useOverlayStore } from "@/workbench/overlays";
import { RELEASES_URL, useCanSelfUpdate, useUpdateStatus } from "./api";

const notified = new Set<string>();
let availableToastId: string | null = null;
let availableToastVersion: string | null = null;

function runAction(action: () => Promise<unknown>, errorTitle: string): void {
  void action().catch((error) => toast.error(errorTitle, errorMessage(error)));
}

export function useUpdateNotifier() {
  const { t } = useI18n();
  const state = useUpdateStatus();
  const canSelfUpdate = useCanSelfUpdate();

  useEffect(() => {
    const { push, dismiss } = useToastStore.getState();

    if (state.status !== "available" && availableToastId) {
      dismiss(availableToastId);
      availableToastId = null;
      availableToastVersion = null;
    }

    if (
      state.status === "available" &&
      canSelfUpdate !== null &&
      !notified.has(state.version)
    ) {
      notified.add(state.version);
      if (availableToastId && availableToastVersion !== state.version) {
        dismiss(availableToastId);
      }
      if (canSelfUpdate) {
        availableToastId = push({
          kind: "info",
          title: t("settings.about.update.available", {
            version: state.version,
          }),
          persistent: true,
          actions: [
            {
              label: t("settings.about.update.install"),
              onClick: () =>
                runAction(
                  ipc.update.install,
                  t("settings.about.update.installError"),
                ),
            },
            {
              label: t("settings.about.update.details"),
              onClick: () => useOverlayStore.getState().openSettings("about"),
            },
          ],
        });
      } else {
        availableToastId = push({
          kind: "info",
          title: t("settings.about.update.available", {
            version: state.version,
          }),
          actions: [
            {
              label: t("settings.about.update.viewRelease"),
              onClick: () =>
                runAction(
                  () => openUrl(RELEASES_URL),
                  t("settings.about.openLinkError"),
                ),
            },
          ],
        });
      }
      availableToastVersion = state.version;
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
            onClick: () =>
              runAction(relaunch, t("settings.about.update.restartError")),
          },
        ],
      });
    }

    if (
      state.status === "error" &&
      state.operation === "install" &&
      !notified.has(`install-error:${state.message}`)
    ) {
      notified.add(`install-error:${state.message}`);
      push({
        kind: "error",
        title: t("settings.about.update.installError"),
        description: state.message,
      });
    }
  }, [state, t, canSelfUpdate]);
}

export function UpdateNotifier() {
  useUpdateNotifier();
  return null;
}
