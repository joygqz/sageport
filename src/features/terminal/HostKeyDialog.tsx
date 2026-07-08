import { useEffect, useState } from "react";
import { ShieldAlert, ShieldQuestion } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogToolbar,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import type { HostKeyDecision, HostKeyEvent } from "@/types/models";

export function HostKeyDialog() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<HostKeyEvent[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void ipc.ssh
      .onHostKey((event) =>
        setQueue((q) =>
          q.some((e) => e.promptId === event.promptId) ? q : [...q, event],
        ),
      )
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const current = queue[0];

  const respond = (decision: HostKeyDecision) => {
    if (!current) return;
    void ipc.ssh.respondHostKey(current.promptId, decision).catch(() => {});
    setQueue((q) => q.filter((e) => e.promptId !== current.promptId));
  };

  const changed = current?.status === "changed";

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => !open && respond("reject")}
    >
      <DialogContent
        showClose={false}
        className="flex w-[460px] max-w-[92vw] flex-col gap-0 p-0"
      >
        {current && (
          <>
            <DialogToolbar>
              {changed ? t("hostKey.changedTitle") : t("hostKey.unknownTitle")}
            </DialogToolbar>
            <div className="flex flex-col gap-4 p-5">
              <div className="flex gap-3">
                <div
                  className={cn(
                    "mt-0.5 shrink-0",
                    changed ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {changed ? (
                    <ShieldAlert className="size-5" />
                  ) : (
                    <ShieldQuestion className="size-5" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t(
                    changed
                      ? "hostKey.changedDescription"
                      : "hostKey.unknownDescription",
                    { host: `${current.host}:${current.port}` },
                  )}
                </p>
              </div>

              <dl className="rounded-md border border-input bg-surface p-3 text-xs">
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-muted-foreground">
                    {t("hostKey.keyType")}
                  </dt>
                  <dd className="font-mono">{current.keyType}</dd>
                </div>
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="shrink-0 text-muted-foreground">
                    {t("hostKey.fingerprint")}
                  </dt>
                  <dd className="break-all text-right font-mono">
                    {current.fingerprint}
                  </dd>
                </div>
              </dl>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => respond("reject")}>
                  {t("hostKey.reject")}
                </Button>
                <Button variant="outline" onClick={() => respond("once")}>
                  {t("hostKey.once")}
                </Button>
                <Button
                  variant={changed ? "destructive" : "primary"}
                  onClick={() => respond("remember")}
                >
                  {t("hostKey.remember")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
