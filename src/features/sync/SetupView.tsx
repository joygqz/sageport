import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, ExternalLink } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  PasswordInput,
  Spinner,
  Switch,
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

/** Progress of the browser authorization for the selected OAuth provider. */
type OAuthPhase =
  | { step: "idle" }
  | { step: "device"; userCode: string; verificationUri: string }
  | { step: "browser" }
  | { step: "authorized"; account: string };

/**
 * Disconnected state: pick one of the five providers, authorize or fill in
 * credentials, choose the vault passphrase, connect.
 */
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
    setKind(next);
    setOAuth({ step: "idle" });
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
      toast.error(t("settings.sync.setup.connectError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.description")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SYNC_PROVIDERS.map((p) => {
          const Icon = p.icon;
          const active = p.kind === kind;
          return (
            <button
              key={p.kind}
              onClick={() => selectProvider(p.kind)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-list-active/40 ring-1 ring-primary/40"
                  : "border-border hover:border-ring hover:bg-list-hover",
              )}
            >
              <Icon className="size-5 text-foreground" />
              <span className="text-sm font-medium text-foreground">
                {p.name}
              </span>
              <span className="text-xs leading-snug text-muted-foreground">
                {t(p.taglineKey)}
              </span>
            </button>
          );
        })}
      </div>

      {meta.oauth ? (
        oauthReady ? (
          <OAuthPanel
            kind={kind}
            name={meta.name}
            phase={oauth}
            onPhase={setOAuth}
          />
        ) : (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
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
              {t("settings.sync.setup.mismatchCancelButton")}
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

/** Sign-in button plus the in-flight states of the browser authorization. */
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

  const begin = async () => {
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
      onPhase({ step: "authorized", account });
    } catch (err) {
      onPhase({ step: "idle" });
      if (errorCode(err) !== "cancelled") {
        toast.error(t("settings.sync.setup.oauthError"), errorMessage(err));
      }
    }
  };

  // The pending `oauthStart` rejects with `cancelled` and resets the phase.
  const cancel = () => void ipc.sync.oauthCancel();

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (phase.step === "device") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted-foreground">
          {t("settings.sync.setup.deviceCodeHint")}
        </p>
        <div className="flex items-center gap-2">
          <code className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-widest text-foreground">
            {phase.userCode}
          </code>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            onClick={() => void copyCode(phase.userCode)}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void openUrl(phase.verificationUri)}
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
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
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
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <Check className="size-4 text-primary" />
        <p className="flex-1 text-sm text-foreground">
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

/** Credential fields (WebDAV / S3), the shared passphrase, and Connect. */
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
      ? !!webdav.url
      : kind === "s3"
        ? !!(s3.endpoint && s3.bucket && s3.accessKey && s3.secretKey)
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
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.sync.setup.usernameLabel")}>
              <Input
                value={webdav.username}
                onChange={(e) =>
                  setWebdav({ ...webdav, username: e.target.value })
                }
                autoComplete="off"
              />
            </Field>
            <Field label={t("settings.sync.setup.passwordLabel")}>
              <PasswordInput
                value={webdav.password}
                onChange={(e) =>
                  setWebdav({ ...webdav, password: e.target.value })
                }
                autoComplete="off"
              />
            </Field>
          </div>
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
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.sync.setup.s3BucketLabel")} required>
              <Input
                value={s3.bucket}
                onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                autoComplete="off"
                spellCheck={false}
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
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("settings.sync.setup.s3AccessKeyLabel")} required>
              <PasswordInput
                value={s3.accessKey}
                onChange={(e) => setS3({ ...s3, accessKey: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label={t("settings.sync.setup.s3SecretKeyLabel")} required>
              <PasswordInput
                value={s3.secretKey}
                onChange={(e) => setS3({ ...s3, secretKey: e.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
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
            />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-foreground">
                {t("settings.sync.setup.s3PathStyleLabel")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.sync.setup.s3PathStyleHint")}
              </p>
            </div>
            <Switch
              checked={s3.pathStyle}
              onCheckedChange={(v) => setS3({ ...s3, pathStyle: v })}
            />
          </div>
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
