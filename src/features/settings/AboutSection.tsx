import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import type { ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui";
import { useI18n, type TFunction } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { UpdateStatus } from "@/types/models";
import {
  RELEASES_URL,
  useCanSelfUpdate,
  useUpdateStatus,
} from "@/features/updates/api";
import { updateDownloadProgress } from "@/features/updates/progress";

const AUTHOR_NAME = "Quincy Zhang";
const AUTHOR_URL = "https://github.com/joygqz";
const LICENSE_NAME = "GNU GPL v3.0 only";
const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";

function openExternal(url: string, t: TFunction): void {
  void openUrl(url).catch((error) =>
    toast.error(t("settings.about.openLinkError"), errorMessage(error)),
  );
}

function runUpdateAction(
  action: () => Promise<unknown>,
  errorTitle: string,
): void {
  void action().catch((error) => toast.error(errorTitle, errorMessage(error)));
}

export function AboutSection() {
  const { t } = useI18n();
  const state = useUpdateStatus();
  const canSelfUpdate = useCanSelfUpdate();

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
            {t("settings.about.author")}{" "}
            <button
              type="button"
              className="rounded-sm text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={() => openExternal(AUTHOR_URL, t)}
            >
              {AUTHOR_NAME}
            </button>
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.about.license")}{" "}
            <button
              type="button"
              className="rounded-sm text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/35"
              onClick={() => openExternal(LICENSE_URL, t)}
            >
              {LICENSE_NAME}
            </button>
          </p>
        </div>
      </div>

      <UpdateStatusCard state={state} canSelfUpdate={canSelfUpdate} />
    </div>
  );
}

function UpdateStatusCard({
  state,
  canSelfUpdate,
}: {
  state: UpdateStatus;
  canSelfUpdate: boolean | null;
}) {
  const { t } = useI18n();
  const progress = updateDownloadProgress(state);

  let title = t("settings.about.update.title");
  let description = t("settings.about.update.idle");
  let icon = <RefreshCw />;
  let iconClassName = "text-muted-foreground";
  let action: ReactNode = (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        runUpdateAction(ipc.update.check, t("settings.about.update.checkError"))
      }
    >
      <RefreshCw />
      {t("settings.about.update.check")}
    </Button>
  );

  if (state.status === "checking") {
    title = t("settings.about.update.checking");
    description = t("settings.about.update.currentVersion", {
      version: __APP_VERSION__,
    });
    icon = <RefreshCw className="animate-spin" />;
    iconClassName = "text-link";
    action = null;
  } else if (state.status === "up-to-date") {
    title = t("settings.about.update.upToDate");
    description = t("settings.about.update.currentVersion", {
      version: __APP_VERSION__,
    });
    icon = <CheckCircle2 />;
    iconClassName = "text-success";
  } else if (state.status === "available") {
    title = t("settings.about.update.available", { version: state.version });
    description =
      state.body ??
      t("settings.about.update.currentVersion", { version: __APP_VERSION__ });
    icon = <Sparkles />;
    iconClassName = "text-link";
    action =
      canSelfUpdate === true ? (
        <Button
          size="sm"
          onClick={() =>
            runUpdateAction(
              ipc.update.install,
              t("settings.about.update.installError"),
            )
          }
        >
          <Download />
          {t("settings.about.update.install")}
        </Button>
      ) : (
        <Button size="sm" onClick={() => openExternal(RELEASES_URL, t)}>
          <ExternalLink />
          {t("settings.about.update.viewRelease")}
        </Button>
      );
  } else if (state.status === "downloading") {
    title = t("settings.about.update.downloadingVersion", {
      version: state.version,
    });
    description =
      progress === null
        ? t("settings.about.update.downloading")
        : t("settings.about.update.downloadingProgress", {
            percent: progress,
          });
    icon = <Download />;
    iconClassName = "text-link";
    action = null;
  } else if (state.status === "ready") {
    title = t("settings.about.update.ready", { version: state.version });
    description = t("settings.about.update.restartHint");
    icon = <CheckCircle2 />;
    iconClassName = "text-success";
    action = (
      <Button
        size="sm"
        onClick={() =>
          runUpdateAction(relaunch, t("settings.about.update.restartError"))
        }
      >
        <RefreshCw />
        {t("settings.about.update.restart")}
      </Button>
    );
  } else if (state.status === "error") {
    title = t(
      state.operation === "install"
        ? "settings.about.update.installError"
        : "settings.about.update.checkError",
    );
    description = state.message;
    icon = <CircleAlert />;
    iconClassName = "text-danger";
  }

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center [&_svg]:size-5",
          iconClassName,
        )}
        aria-hidden="true"
      >
        {icon}
      </span>

      <div className="flex min-w-0 flex-1 basis-64 flex-col">
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <p
          className={cn(
            "mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground",
            state.status === "error" && "select-text text-danger",
          )}
        >
          {description}
        </p>

        {state.status === "downloading" && (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress ?? undefined}
          >
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-[width] duration-300",
                progress === null && "w-1/3 animate-pulse",
              )}
              style={progress === null ? undefined : { width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </section>
  );
}
