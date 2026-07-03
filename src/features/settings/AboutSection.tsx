import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { CheckCircle2, RotateCw, Sparkles } from "lucide-react";

import { Badge, Button, Spinner } from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import type { UpdateStatus } from "@/types/models";

export function AboutSection() {
  const { t } = useI18n();
  const { data: version } = useQuery({
    queryKey: ["app", "version"],
    queryFn: getVersion,
  });
  const [state, setState] = useState<UpdateStatus>({ status: "idle" });

  // The update lifecycle lives in the Rust backend (see `update::UpdateManager`),
  // not in this component: Settings is a real OS window that gets destroyed on
  // close, so any state kept here would be lost the moment the user closed the
  // dialog mid-download. Sync to the current status on mount, then follow live
  // updates broadcast to every window.
  useEffect(() => {
    let cancelled = false;
    void ipc.update.status().then((s) => {
      if (!cancelled) setState(s);
    });
    const unlisten = ipc.update.onStatus((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      void unlisten.then((un) => un());
    };
  }, []);

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
                {t("settings.about.update.checkButton")}
              </Button>
            )}

            {state.status === "available" && (
              <Button size="sm" onClick={() => void ipc.update.install()}>
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
          <Sparkles className="size-4 text-primary" />
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
    <p className="text-sm text-destructive">
      {t("settings.about.update.error", { message: state.message })}
    </p>
  );
}
