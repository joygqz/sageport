import { useEffect, useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogToolbar,
  Field,
  PasswordInput,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import {
  listenPasswordPrompts,
  usePasswordPromptStore,
} from "./password-prompt";

export function PasswordPromptDialog() {
  const queue = usePasswordPromptStore((state) => state.queue);
  const respondTo = usePasswordPromptStore((state) => state.respond);
  const current = queue[0];

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listenPasswordPrompts().then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) =>
        !open && current && respondTo(current.promptId, null)
      }
    >
      <DialogContent
        showClose={false}
        className="flex w-[440px] max-w-[92vw] flex-col gap-0 p-0 sm:p-0"
      >
        {current && (
          <PasswordPromptForm
            key={current.promptId}
            host={formatSshHost(current.host, current.port)}
            username={current.username}
            onRespond={(password) => respondTo(current.promptId, password)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatSshHost(host: string, port: number) {
  if (port === 22) return host;
  const address =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${address}:${port}`;
}

function PasswordPromptForm({
  host,
  username,
  onRespond,
}: {
  host: string;
  username: string;
  onRespond: (password: string | null) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onRespond(password);
  };

  return (
    <>
      <DialogToolbar>{t("ssh.passwordPrompt.title")}</DialogToolbar>
      <form className="flex flex-col gap-4 p-5" onSubmit={submit}>
        <p className="font-mono text-sm leading-relaxed text-muted-foreground">
          {t("ssh.passwordPrompt.description", { host, username })}
        </p>
        <Field label={t("ssh.passwordPrompt.password")}>
          <PasswordInput
            autoFocus
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onRespond(null)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!password}>
            {t("ssh.passwordPrompt.connect")}
          </Button>
        </div>
      </form>
    </>
  );
}
