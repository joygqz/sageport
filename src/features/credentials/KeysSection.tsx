import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FileUp, KeyRound, Plus, Sparkles, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  Input,
  PasswordInput,
  Select,
  Textarea,
} from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { emitRefresh } from "@/lib/windows";
import type { SshKey, SshKeyAlgorithm } from "@/types/models";
import {
  useCreateSshKey,
  useDeleteSshKey,
  useGenerateSshKey,
  useImportSshKeyFile,
  useSshKeys,
} from "./api";

type Mode = "closed" | "generate" | "import";

const ALGORITHMS: { value: SshKeyAlgorithm; labelKey: TKey }[] = [
  { value: "ed25519", labelKey: "keys.algorithm.ed25519" },
  { value: "rsa2048", labelKey: "keys.algorithm.rsa2048" },
  { value: "rsa4096", labelKey: "keys.algorithm.rsa4096" },
  { value: "ecdsaP256", labelKey: "keys.algorithm.ecdsaP256" },
  { value: "ecdsaP384", labelKey: "keys.algorithm.ecdsaP384" },
  { value: "ecdsaP521", labelKey: "keys.algorithm.ecdsaP521" },
];

export function KeysSection() {
  const { t } = useI18n();
  const { data: keys = [] } = useSshKeys();
  const createKey = useCreateSshKey();
  const generateKey = useGenerateSshKey();
  const importFile = useImportSshKeyFile();
  const deleteKey = useDeleteSshKey();

  const [mode, setMode] = useState<Mode>("closed");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>("ed25519");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const reset = () => {
    setMode("closed");
    setName("");
    setPassphrase("");
    setAlgorithm("ed25519");
    setPrivateKey("");
    setPublicKey("");
  };

  const pickFile = async () => {
    const selected = await open({
      title: t("keys.import.chooseFileTitle"),
      multiple: false,
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    try {
      const file = await importFile.mutateAsync(path);
      setName((prev) => prev || file.name);
      setPrivateKey(file.privateKey);
      setPublicKey(file.publicKey ?? "");
    } catch (err) {
      toast.error(t("keys.import.readError"), errorMessage(err));
    }
  };

  const submitGenerate = async () => {
    if (!name.trim()) return toast.error(t("keys.nameRequired"));
    try {
      await generateKey.mutateAsync({
        name: name.trim(),
        algorithm,
        passphrase: passphrase || null,
      });
      await emitRefresh();
      reset();
    } catch (err) {
      toast.error(t("keys.addError"), errorMessage(err));
    }
  };

  const submitImport = async () => {
    if (!name.trim() || !privateKey.trim()) {
      return toast.error(t("keys.nameKeyRequired"));
    }
    try {
      await createKey.mutateAsync({
        name: name.trim(),
        privateKey,
        publicKey: publicKey || null,
        passphrase: passphrase || null,
      });
      await emitRefresh();
      reset();
    } catch (err) {
      toast.error(t("keys.addError"), errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    await deleteKey.mutateAsync(id);
    await emitRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {mode === "closed" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                <Plus /> {t("keys.addKey")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setMode("generate")}>
                <Sparkles /> {t("keys.generateNew")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMode("import")}>
                <FileUp /> {t("keys.importOrPaste")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {mode === "generate" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Field label={t("keys.name")} required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("keys.namePlaceholder")}
            />
          </Field>
          <Field label={t("keys.algorithmLabel")}>
            <Select
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as SshKeyAlgorithm)}
            >
              {ALGORITHMS.map((a) => (
                <option key={a.value} value={a.value}>
                  {t(a.labelKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t("keys.passphrase")}
            hint={t("keys.generatePassphraseHint")}
          >
            <PasswordInput
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={submitGenerate}
              loading={generateKey.isPending}
            >
              {t("keys.generateButton")}
            </Button>
          </div>
        </div>
      )}

      {mode === "import" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Field label={t("keys.name")} required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("keys.namePlaceholder")}
            />
          </Field>
          <Field label={t("keys.privateKey")} required hint={t("keys.privateKeyHint")}>
            <div className="flex flex-col gap-2">
              <Textarea
                rows={5}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={t("keys.privateKeyPlaceholder")}
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={pickFile}
                loading={importFile.isPending}
              >
                <FileUp /> {t("keys.chooseFile")}
              </Button>
            </div>
          </Field>
          <Field label={t("keys.passphrase")} hint={t("keys.passphraseHint")}>
            <PasswordInput
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={submitImport} loading={createKey.isPending}>
              {t("keys.saveKey")}
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 && mode === "closed" ? (
        <EmptyState
          icon={KeyRound}
          title={t("keys.emptyTitle")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {keys.map((k) => (
            <KeyRow key={k.id} sshKey={k} onDelete={() => remove(k.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Short algorithm tag parsed from the OpenSSH public key line, e.g. `ed25519`. */
function algorithmTag(publicKey: string | null): string | null {
  const token = publicKey?.trim().split(/\s+/)[0];
  if (!token) return null;
  return token.replace(/^ssh-/, "").replace(/^ecdsa-sha2-nistp/, "ecdsa-p");
}

function KeyRow({
  sshKey,
  onDelete,
}: {
  sshKey: SshKey;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const tag = algorithmTag(sshKey.publicKey);

  const copyPublicKey = async () => {
    if (!sshKey.publicKey) return;
    await navigator.clipboard.writeText(sshKey.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{sshKey.name}</span>
      {tag && (
        <Badge className="font-mono text-[10px] uppercase">{tag}</Badge>
      )}
      {sshKey.publicKey && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={copyPublicKey}
          title={t("keys.copyPublicKey")}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="ml-auto size-7"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
