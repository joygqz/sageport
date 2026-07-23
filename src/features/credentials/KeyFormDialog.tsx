import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp } from "lucide-react";

import {
  Button,
  Field,
  FormBody,
  FormDialog,
  Input,
  PasswordInput,
  SegmentedControl,
  Select,
  Textarea,
} from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { SshKey, SshKeyAlgorithm } from "@/types/models";
import {
  useCreateSshKey,
  useGenerateSshKey,
  useImportSshKeyFile,
  useUpdateSshKey,
} from "./api";

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
  sshKey,
  onClose,
}: {
  open: boolean;
  sshKey: SshKey | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={isOpen}
      onClose={onClose}
      width="w-[520px]"
      title={
        sshKey
          ? t("credentials.keys.editTitle")
          : t("credentials.keys.formTitle")
      }
    >
      <KeyFormBody key={sshKey?.id ?? "new"} sshKey={sshKey} onClose={onClose} />
    </FormDialog>
  );
}

function KeyFormBody({
  sshKey,
  onClose,
}: {
  sshKey: SshKey | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const createKey = useCreateSshKey();
  const generateKey = useGenerateSshKey();
  const importFile = useImportSshKeyFile();
  const updateKey = useUpdateSshKey();

  const [mode, setMode] = useState<Mode>("generate");
  const [name, setName] = useState(sshKey?.name ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseEdited, setPassphraseEdited] = useState(false);
  const [algorithm, setAlgorithm] = useState<SshKeyAlgorithm>("ed25519");
  const [privateKey, setPrivateKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const editing = Boolean(sshKey);

  const revealSavedPassphrase = async () => {
    if (passphrase) return true;
    if (!sshKey?.hasPassphrase) return true;
    try {
      setPassphrase(await ipc.keys.revealPassphrase(sshKey.id));
      setPassphraseEdited(false);
      return true;
    } catch (error) {
      toast.error(
        t("credentials.keys.passphraseRevealError"),
        errorMessage(error),
      );
      return false;
    }
  };

  const pickFile = async () => {
    try {
      const selected = await open({
        title: t("credentials.keys.import.chooseFile"),
        multiple: false,
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
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
    if (editing && passphraseEdited && !privateKey.trim()) {
      return toast.error(t("credentials.keys.passphraseRequiresPrivateKey"));
    }
    try {
      if (sshKey) {
        const replacingMaterial = privateKey.trim().length > 0;
        await updateKey.mutateAsync({
          id: sshKey.id,
          input: {
            name: name.trim(),
            ...(replacingMaterial
              ? {
                  privateKey,
                  publicKey: publicKey || null,
                  passphrase: passphrase || "",
                }
              : {}),
          },
        });
      } else if (mode === "generate") {
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
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={
        editing
          ? t("common.saveChanges")
          : mode === "generate"
            ? t("credentials.keys.generateAction")
            : t("credentials.keys.importAction")
      }
      pending={
        generateKey.isPending ||
        createKey.isPending ||
        updateKey.isPending ||
        importFile.isPending
      }
    >
      {!editing && (
        <SegmentedControl
          value={mode}
          onChange={setMode}
          options={[
            { value: "generate", label: t("credentials.keys.modeGenerate") },
            { value: "import", label: t("credentials.keys.modeImport") },
          ]}
        />
      )}

      <Field label={t("credentials.keys.name")} required>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("credentials.keys.namePlaceholder")}
        />
      </Field>

      {editing && sshKey?.publicKey && (
        <Field label={t("credentials.keys.publicKey")}>
          <Textarea
            rows={3}
            value={sshKey.publicKey}
            readOnly
            className="font-mono text-xs"
          />
        </Field>
      )}

      {!editing && mode === "generate" ? (
        <>
          <Field label={t("credentials.keys.algorithmLabel")}>
            <Select
              value={algorithm}
              onValueChange={(value) => setAlgorithm(value as SshKeyAlgorithm)}
              options={ALGORITHMS.map((item) => ({
                value: item.value,
                label: t(item.labelKey),
              }))}
            />
          </Field>
          <Field
            label={t("credentials.keys.passphrase")}
            hint={t("credentials.keys.generatePassphraseHint")}
          >
            <PasswordInput
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value);
                setPassphraseEdited(true);
              }}
              autoComplete="off"
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={t("credentials.keys.privateKey")}
            required={!editing}
            hint={
              editing
                ? t("credentials.keys.privateKeyReplaceHint")
                : t("credentials.keys.privateKeyHint")
            }
          >
            <div className="flex flex-col gap-2">
              <Textarea
                rows={5}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={
                  editing
                    ? t("credentials.keys.privateKeyKeepPlaceholder")
                    : "-----BEGIN OPENSSH PRIVATE KEY-----"
                }
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
              onChange={(e) => {
                setPassphrase(e.target.value);
                setPassphraseEdited(true);
              }}
              autoComplete="off"
              placeholder={sshKey?.hasPassphrase ? "••••••••" : undefined}
              onBeforeReveal={
                sshKey?.hasPassphrase ? revealSavedPassphrase : undefined
              }
            />
          </Field>
        </>
      )}
    </FormBody>
  );
}
