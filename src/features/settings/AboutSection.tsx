import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { CheckCircle2, RotateCw, Sparkles } from "lucide-react";

import { Badge, Button, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; update: Update }
  | { status: "downloading"; update: Update; downloaded: number; total: number | null }
  | { status: "ready"; update: Update }
  | { status: "error"; message: string };

export function AboutSection() {
  const { t } = useI18n();
  const { data: version } = useQuery({
    queryKey: ["app", "version"],
    queryFn: getVersion,
  });
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  const checkForUpdate = async () => {
    setState({ status: "checking" });
    try {
      const update = await check();
      setState(
        update ? { status: "available", update } : { status: "up-to-date" },
      );
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
  };

  const installUpdate = async (update: Update) => {
    setState({ status: "downloading", update, downloaded: 0, total: null });
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setState({ status: "downloading", update, downloaded, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({ status: "downloading", update, downloaded, total });
        }
      });
      setState({ status: "ready", update });
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
      toast.error(t("settings.about.update.installError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <img
          src="/app-icon.png"
          alt=""
          className="size-14 shrink-0 rounded-xl"
        />
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Sageport
          </h3>
          <p className="text-sm text-muted-foreground">
            {version
              ? t("settings.about.version", { version })
              : t("common.loading")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <UpdateStatus state={state} />

        {state.status !== "checking" && (
          <div className="flex items-center gap-2">
            {(state.status === "idle" ||
              state.status === "up-to-date" ||
              state.status === "error") && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void checkForUpdate()}
              >
                <RotateCw />
                {t("settings.about.update.checkButton")}
              </Button>
            )}

            {state.status === "available" && (
              <Button
                size="sm"
                onClick={() => void installUpdate(state.update)}
              >
                {t("settings.about.update.installButton")}
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
                {t("settings.about.update.restartButton")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UpdateStatus({ state }: { state: UpdateState }) {
  const { t } = useI18n();

  if (state.status === "idle") {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.about.update.idle")}
      </p>
    );
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
          <Sparkles className="size-4 text-primary" />
          {t("settings.about.update.available", {
            version: state.update.version,
          })}
        </p>
        {state.update.body && (
          <p className="whitespace-pre-line text-xs text-muted-foreground">
            {state.update.body}
          </p>
        )}
      </div>
    );
  }
  if (state.status === "downloading") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-foreground">
          {t("settings.about.update.available", {
            version: state.update.version,
          })}
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
        {t("settings.about.update.ready", { version: state.update.version })}
      </p>
    );
  }
  return (
    <p className="text-sm text-destructive">
      {t("settings.about.update.error", { message: state.message })}
    </p>
  );
}
