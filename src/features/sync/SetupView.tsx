import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink } from "lucide-react";

import {
  Button,
  CONTROL_BORDER_CLASS,
  CONTROL_FOCUS_CLASS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  PasswordInput,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  SwitchField,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  SyncProviderKind,
  SyncProviderSettings,
  SyncStatus,
} from "@/types/models";
import { useSyncConnect, useSyncOAuthStart } from "./api";
import { SYNC_PROVIDERS, providerMeta } from "./providers";

type OAuthPhase =
  | { step: "idle" }
  | { step: "device"; userCode: string; verificationUri: string }
  | { step: "browser" }
  | { step: "authorized"; account: string };

export function SetupView({ status }: { status: SyncStatus }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SyncProviderKind>("gist");
  const [oauth, setOAuth] = useState<OAuthPhase>({ step: "idle" });
  const [passphrase, setPassphrase] = useState("");
  const [mismatch, setMismatch] = useState<{
    settings?: SyncProviderSettings;
  } | null>(null);
  const connect = useSyncConnect();

  const meta = providerMeta(kind);
  const oauthReady = status.oauthReady[kind as keyof SyncStatus["oauthReady"]];

  const selectProvider = (next: SyncProviderKind) => {
    if (next === kind) return;
    void ipc.sync.oauthCancel().catch(() => undefined);
    setKind(next);
    setOAuth({ step: "idle" });
    setPassphrase("");
    setMismatch(null);
  };

  const doConnect = async (settings?: SyncProviderSettings, force = false) => {
    try {
      const outcome = await connect.mutateAsync({
        provider: kind,
        settings,
        passphrase,
        force,
      });
      if (outcome.status === "passphraseMismatch") {
        setMismatch({ settings });
        return;
      }
      setMismatch(null);
      toast.success(t("settings.sync.setup.connectedTitle"));
    } catch (err) {
      setMismatch(null);
      toast.error(
        t("settings.sync.setup.connectError"),
        errorCode(err) === "serde"
          ? t("settings.sync.corruptRemoteBackup")
          : errorMessage(err),
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={kind}
        disabled={connect.isPending}
        onValueChange={(value) => selectProvider(value as SyncProviderKind)}
        aria-label={t("settings.sync.providerLabel")}
        className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-2"
      >
        {SYNC_PROVIDERS.map((p) => {
          const Icon = p.icon;
          const active = p.kind === kind;
          return (
            <RadioGroupItem
              key={p.kind}
              value={p.kind}
              className={cn(
                "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors",
                CONTROL_FOCUS_CLASS,
                active
                  ? "border-primary ring-2 ring-primary/25"
                  : cn(CONTROL_BORDER_CLASS, "hover:bg-list-hover"),
              )}
            >
              <Icon className="size-5 text-foreground" />
              <span className="text-sm font-medium text-foreground">
                {p.name}
              </span>
              <span className="text-xs leading-snug text-muted-foreground">
                {t(p.taglineKey)}
              </span>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>

      {meta.oauth ? (
        oauthReady ? (
          <OAuthPanel
            kind={kind}
            name={meta.name}
            phase={oauth}
            onPhase={setOAuth}
          />
        ) : (
          <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            {t("settings.sync.setup.oauthUnavailable", { name: meta.name })}
          </p>
        )
      ) : null}

      {(!meta.oauth || oauth.step === "authorized") && (
        <ConnectForm
          kind={kind}
          passphrase={passphrase}
          onPassphrase={setPassphrase}
          pending={connect.isPending}
          onConnect={(settings) => void doConnect(settings)}
        />
      )}

      <Dialog
        open={!!mismatch}
        onOpenChange={(open) => !open && setMismatch(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.sync.setup.mismatchTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.sync.setup.mismatchDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMismatch(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              loading={connect.isPending}
              onClick={() => void doConnect(mismatch?.settings, true)}
            >
              {t("settings.sync.setup.mismatchForceButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OAuthPanel({
  kind,
  name,
  phase,
  onPhase,
}: {
  kind: SyncProviderKind;
  name: string;
  phase: OAuthPhase;
  onPhase: (p: OAuthPhase) => void;
}) {
  const { t } = useI18n();
  const start = useSyncOAuthStart();
  const [copied, setCopied] = useState(false);
  const attemptRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      attemptRef.current += 1;
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      void ipc.sync.oauthCancel().catch(() => undefined);
    };
  }, [kind]);

  const begin = async () => {
    const attempt = ++attemptRef.current;
    try {
      const { account } = await start.mutateAsync({
        provider: kind,
        onEvent: (e) => {
          if (e.type === "deviceCode") {
            onPhase({
              step: "device",
              userCode: e.userCode,
              verificationUri: e.verificationUri,
            });
          } else if (e.type === "browser") {
            onPhase({ step: "browser" });
          }
        },
      });
      if (attempt !== attemptRef.current) return;
      onPhase({ step: "authorized", account });
    } catch (err) {
      if (attempt !== attemptRef.current) return;
      onPhase({ step: "idle" });
      if (errorCode(err) !== "cancelled") {
        toast.error(t("settings.sync.setup.oauthError"), errorMessage(err));
      }
    }
  };

  const cancel = () => {
    attemptRef.current += 1;
    onPhase({ step: "idle" });
    void ipc.sync.oauthCancel().catch((err) => {
      toast.error(t("settings.sync.setup.oauthError"), errorMessage(err));
    });
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(t("common.copy"), errorMessage(err));
    }
  };

  const openVerificationPage = async (url: string) => {
    try {
      await openUrl(url);
    } catch (err) {
      toast.error(t("settings.sync.setup.oauthError"), errorMessage(err));
    }
  };

  if (phase.step === "device") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {t("settings.sync.setup.deviceCodeHint")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md border border-input bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-widest text-foreground">
            {phase.userCode}
          </code>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={copied ? t("common.copied") : t("common.copy")}
            onClick={() => void copyCode(phase.userCode)}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void openVerificationPage(phase.verificationUri)}
          >
            <ExternalLink className="size-3.5" />
            {t("settings.sync.setup.openPageButton")}
          </Button>
          <Button variant="ghost" size="sm" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Spinner className="ml-auto" />
        </div>
      </div>
    );
  }

  if (phase.step === "browser") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Spinner />
        <p className="flex-1 text-sm text-muted-foreground">
          {t("settings.sync.setup.browserWaiting")}
        </p>
        <Button variant="ghost" size="sm" onClick={cancel}>
          {t("common.cancel")}
        </Button>
      </div>
    );
  }

  if (phase.step === "authorized") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <Check className="size-4 text-link" />
        <p className="min-w-0 flex-1 text-sm text-foreground">
          {t("settings.sync.setup.authorizedAs", { account: phase.account })}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void begin()}>
          {t("settings.sync.setup.reauthorizeButton")}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Button onClick={() => void begin()} loading={start.isPending}>
        {t("settings.sync.setup.oauthSignIn", { name })}
      </Button>
    </div>
  );
}

function ConnectForm({
  kind,
  passphrase,
  onPassphrase,
  pending,
  onConnect,
}: {
  kind: SyncProviderKind;
  passphrase: string;
  onPassphrase: (v: string) => void;
  pending: boolean;
  onConnect: (settings?: SyncProviderSettings) => void;
}) {
  const { t } = useI18n();
  const [webdav, setWebdav] = useState({ url: "", username: "", password: "" });
  const [s3, setS3] = useState({
    endpoint: "",
    region: "",
    bucket: "",
    prefix: "",
    accessKey: "",
    secretKey: "",
    pathStyle: false,
  });

  const settings: SyncProviderSettings | undefined =
    kind === "webdav" ? webdav : kind === "s3" ? s3 : undefined;
  const formReady =
    kind === "webdav"
      ? !!webdav.url.trim()
      : kind === "s3"
        ? !!(
            s3.endpoint.trim() &&
            s3.bucket.trim() &&
            s3.accessKey.trim() &&
            s3.secretKey
          )
        : true;

  return (
    <div className="flex flex-col gap-4">
      {kind === "webdav" && (
        <>
          <Field
            label={t("settings.sync.setup.webdavUrlLabel")}
            hint={t("settings.sync.setup.webdavUrlHint")}
            required
          >
            <Input
              value={webdav.url}
              onChange={(e) => setWebdav({ ...webdav, url: e.target.value })}
              placeholder="https://dav.example.com/sageport"
              autoComplete="off"
              spellCheck={false}
              maxLength={8192}
            />
          </Field>
          <>
            <Field label={t("settings.sync.setup.usernameLabel")}>
              <Input
                value={webdav.username}
                onChange={(e) =>
                  setWebdav({ ...webdav, username: e.target.value })
                }
                autoComplete="off"
                maxLength={1024}
              />
            </Field>
            <Field label={t("settings.sync.setup.passwordLabel")}>
              <PasswordInput
                value={webdav.password}
                onChange={(e) =>
                  setWebdav({ ...webdav, password: e.target.value })
                }
                autoComplete="off"
                maxLength={16384}
              />
            </Field>
          </>
        </>
      )}

      {kind === "s3" && (
        <>
          <Field
            label={t("settings.sync.setup.s3EndpointLabel")}
            hint={t("settings.sync.setup.s3EndpointHint")}
            required
          >
            <Input
              value={s3.endpoint}
              onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
              placeholder="https://s3.us-east-1.amazonaws.com"
              autoComplete="off"
              spellCheck={false}
              maxLength={8192}
            />
          </Field>
          <>
            <Field label={t("settings.sync.setup.s3BucketLabel")} required>
              <Input
                value={s3.bucket}
                onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                autoComplete="off"
                spellCheck={false}
                maxLength={1024}
              />
            </Field>
            <Field
              label={t("settings.sync.setup.s3RegionLabel")}
              hint={t("settings.sync.setup.s3RegionHint")}
            >
              <Input
                value={s3.region}
                onChange={(e) => setS3({ ...s3, region: e.target.value })}
                placeholder="us-east-1"
                autoComplete="off"
                spellCheck={false}
                maxLength={1024}
              />
            </Field>
          </>
          <>
            <Field label={t("settings.sync.setup.s3AccessKeyLabel")} required>
              <PasswordInput
                value={s3.accessKey}
                onChange={(e) => setS3({ ...s3, accessKey: e.target.value })}
                autoComplete="off"
                maxLength={16384}
              />
            </Field>
            <Field label={t("settings.sync.setup.s3SecretKeyLabel")} required>
              <PasswordInput
                value={s3.secretKey}
                onChange={(e) => setS3({ ...s3, secretKey: e.target.value })}
                autoComplete="off"
                maxLength={16384}
              />
            </Field>
          </>
          <Field
            label={t("settings.sync.setup.s3PrefixLabel")}
            hint={t("settings.sync.setup.s3PrefixHint")}
          >
            <Input
              value={s3.prefix}
              onChange={(e) => setS3({ ...s3, prefix: e.target.value })}
              placeholder="sageport/"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
            />
          </Field>
          <SwitchField
            label={t("settings.sync.setup.s3PathStyleLabel")}
            description={t("settings.sync.setup.s3PathStyleHint")}
            checked={s3.pathStyle}
            onCheckedChange={(v) => setS3({ ...s3, pathStyle: v })}
          />
        </>
      )}

      <Field
        label={t("settings.sync.setup.passphraseLabel")}
        hint={t("settings.sync.setup.passphraseHint")}
        required
      >
        <PasswordInput
          value={passphrase}
          onChange={(e) => onPassphrase(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
          maxLength={4096}
        />
      </Field>

      <div>
        <Button
          onClick={() => onConnect(settings)}
          disabled={!passphrase || !formReady}
          loading={pending}
        >
          {t("settings.sync.setup.connectButton")}
        </Button>
      </div>
    </div>
  );
}
