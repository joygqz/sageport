import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { CheckCircle2, ExternalLink, RotateCw, Sparkles } from "lucide-react";

import { Badge, Button, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import type { UpdateStatus } from "@/types/models";
import { useUpdateStatus } from "@/features/updates/api";

const AUTHOR_NAME = "Quincy Zhang";
const AUTHOR_URL = "https://github.com/joygqz";

export function AboutSection() {
  const { t } = useI18n();
  const state = useUpdateStatus();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <img
          src="/app-icon.png"
          alt=""
          className="size-14 shrink-0 rounded-xl"
        />
        <div>
          <h3 className="text-base font-semibold text-foreground">Sageport</h3>
          <p className="text-sm text-muted-foreground">
            {t("settings.about.version", { version: __APP_VERSION__ })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.about.author")}
            <button
              type="button"
              className="inline-flex items-center gap-0.5 align-bottom text-link hover:opacity-80"
              onClick={() => void openUrl(AUTHOR_URL)}
            >
              {AUTHOR_NAME}
              <ExternalLink className="size-3" />
            </button>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-input p-4">
        <UpdateStatusView state={state} />

        {state.status !== "checking" && (
          <div className="flex items-center gap-2">
            {(state.status === "idle" ||
              state.status === "up-to-date" ||
              state.status === "error") && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void ipc.update.check()}
              >
                <RotateCw />
                {t("settings.about.update.check")}
              </Button>
            )}

            {state.status === "available" && (
              <Button size="sm" onClick={() => void ipc.update.install()}>
                {t("settings.about.update.install")}
              </Button>
            )}

            {state.status === "downloading" && (
              <Button variant="secondary" size="sm" disabled loading>
                {state.total
                  ? t("settings.about.update.downloadingProgress", {
                      percent: Math.round(
                        (state.downloaded / state.total) * 100,
                      ),
                    })
                  : t("settings.about.update.downloading")}
              </Button>
            )}

            {state.status === "ready" && (
              <Button size="sm" onClick={() => void relaunch()}>
                {t("settings.about.update.restart")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateStatusView({ state }: { state: UpdateStatus }) {
  const { t } = useI18n();

  if (state.status === "idle") {
    return null;
  }
  if (state.status === "checking") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {t("settings.about.update.checking")}
      </p>
    );
  }
  if (state.status === "up-to-date") {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground">
        <CheckCircle2 className="size-4 text-success" />
        {t("settings.about.update.upToDate")}
      </p>
    );
  }
  if (state.status === "available") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="size-4 text-link" />
          {t("settings.about.update.available", { version: state.version })}
        </p>
        {state.body && (
          <p className="whitespace-pre-line text-xs text-muted-foreground">
            {state.body}
          </p>
        )}
      </div>
    );
  }
  if (state.status === "downloading") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-foreground">
          {t("settings.about.update.available", { version: state.version })}
        </p>
        {state.total && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: `${Math.min(100, Math.round((state.downloaded / state.total) * 100))}%`,
              }}
            />
          </div>
        )}
      </div>
    );
  }
  if (state.status === "ready") {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground">
        <Badge variant="success">{t("settings.about.update.readyBadge")}</Badge>
        {t("settings.about.update.ready", { version: state.version })}
      </p>
    );
  }
  return (
    <p className="text-sm text-danger">
      {t("settings.about.update.error", { message: state.message })}
    </p>
  );
}
