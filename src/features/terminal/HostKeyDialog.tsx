import { ShieldAlert, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogToolbar } from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import type { HostKeyDecision } from "@/types/models";
import { useHostKeyStore } from "./host-key";

export function HostKeyDialog() {
  const { t } = useI18n();
  const queue = useHostKeyStore((s) => s.queue);
  const respondTo = useHostKeyStore((s) => s.respond);

  const current = queue[0];

  const respond = (decision: HostKeyDecision) => {
    if (!current) return;
    respondTo(current.promptId, decision);
  };

  const changed = current?.status === "changed";

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => !open && respond("reject")}
    >
      <DialogContent
        showClose={false}
        className="flex w-[460px] max-w-[92vw] flex-col gap-0 p-0 sm:p-0"
      >
        {current && (
          <>
            <DialogToolbar>
              {changed ? t("hostKey.changedTitle") : t("hostKey.unknownTitle")}
            </DialogToolbar>
            <div className="flex flex-col gap-4 p-5">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {changed ? (
                  <ShieldAlert className="float-left mr-2 mt-[3px] size-4 text-danger" />
                ) : (
                  <ShieldQuestion className="float-left mr-2 mt-[3px] size-4 text-muted-foreground" />
                )}
                {t(
                  changed
                    ? "hostKey.changedDescription"
                    : "hostKey.unknownDescription",
                  { host: `${current.host}:${current.port}` },
                )}
              </p>

              <dl className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">
                    {t("hostKey.keyType")}
                  </dt>
                  <dd className="select-text font-mono">{current.keyType}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-muted-foreground">
                    {t("hostKey.fingerprint")}
                  </dt>
                  <dd className="select-text break-all font-mono">
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
