import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogToolbar,
  Field,
  Input,
  PasswordInput,
  Select,
  Textarea,
} from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { SshKeyAlgorithm } from "@/types/models";
import { useCreateSshKey, useGenerateSshKey, useImportSshKeyFile } from "./api";

type Mode = "generate" | "import";

const ALGORITHMS: { value: SshKeyAlgorithm; labelKey: TKey }[] = [
  { value: "ed25519", labelKey: "credentials.keys.algorithm.ed25519" },
  { value: "rsa2048", labelKey: "credentials.keys.algorithm.rsa2048" },
  { value: "rsa4096", labelKey: "credentials.keys.algorithm.rsa4096" },
  { value: "ecdsaP256", labelKey: "credentials.keys.algorithm.ecdsaP256" },
  { value: "ecdsaP384", labelKey: "credentials.keys.algorithm.ecdsaP384" },
  { value: "ecdsaP521", labelKey: "credentials.keys.algorithm.ecdsaP521" },
];

export function KeyFormDialog({
  open: isOpen,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className="flex w-[520px] max-w-[92vw] flex-col gap-0 p-0"
      >
        {isOpen && <KeyFormBody onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function KeyFormBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const createKey = useCreateSshKey();
  const generateKey = useGenerateSshKey();
  const importFile = useImportSshKeyFile();

  const [mode, setMode] = useState<Mode>("generate");
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>("ed25519");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");

  const pickFile = async () => {
    const selected = await open({
      title: t("credentials.keys.import.chooseFile"),
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
      toast.error(t("credentials.keys.import.readError"), errorMessage(err));
    }
  };

  const submit = async () => {
    if (!name.trim()) {
      return toast.error(t("credentials.keys.nameRequired"));
    }
    try {
      if (mode === "generate") {
        await generateKey.mutateAsync({
          name: name.trim(),
          algorithm,
          passphrase: passphrase || null,
        });
      } else {
        if (!privateKey.trim()) {
          return toast.error(t("credentials.keys.privateKeyRequired"));
        }
        await createKey.mutateAsync({
          name: name.trim(),
          privateKey,
          publicKey: publicKey || null,
          passphrase: passphrase || null,
        });
      }
      onClose();
    } catch (err) {
      toast.error(t("credentials.keys.addError"), errorMessage(err));
    }
  };

  return (
    <>
      <DialogToolbar>{t("credentials.keys.formTitle")}</DialogToolbar>
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-input bg-surface p-1">
          {(["generate", "import"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                mode === m
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(
                m === "generate"
                  ? "credentials.keys.modeGenerate"
                  : "credentials.keys.modeImport",
              )}
            </button>
          ))}
        </div>

        <Field label={t("credentials.keys.name")} required>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("credentials.keys.namePlaceholder")}
          />
        </Field>

        {mode === "generate" ? (
          <>
            <Field label={t("credentials.keys.algorithmLabel")}>
              <Select
                value={algorithm}
                onChange={(e) =>
                  setAlgorithm(e.target.value as SshKeyAlgorithm)
                }
              >
                {ALGORITHMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.labelKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("credentials.keys.passphrase")}
              hint={t("credentials.keys.generatePassphraseHint")}
            >
              <PasswordInput
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label={t("credentials.keys.privateKey")}
              required
              hint={t("credentials.keys.privateKeyHint")}
            >
              <div className="flex flex-col gap-2">
                <Textarea
                  rows={5}
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  className="font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={pickFile}
                  loading={importFile.isPending}
                >
                  <FileUp /> {t("credentials.keys.chooseFile")}
                </Button>
              </div>
            </Field>
            <Field
              label={t("credentials.keys.passphrase")}
              hint={t("credentials.keys.passphraseHint")}
            >
              <PasswordInput
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
              />
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            loading={generateKey.isPending || createKey.isPending}
          >
            {mode === "generate"
              ? t("credentials.keys.generateAction")
              : t("credentials.keys.importAction")}
          </Button>
        </div>
      </div>
    </>
  );
}
