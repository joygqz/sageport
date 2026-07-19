import { useState } from "react";

import {
  ConfirmDialog,
  Field,
  FormBody,
  FormDialog,
  Input,
  SegmentedControl,
  Select,
  SwitchField,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type {
  ForwardKind,
  PortForward,
  PortForwardInput,
} from "@/types/models";
import { useHosts } from "@/features/hosts/api";
import { useCreateForward, useUpdateForward } from "./api";
import {
  defaultBindHost,
  formatForwardEndpoint,
  forwardInput,
  isLoopbackBindHost,
} from "./forwardForm";

export function ForwardFormDialog({
  open,
  forward,
  onClose,
}: {
  open: boolean;
  forward: PortForward | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[480px]"
      title={
        forward ? t("forwards.form.editTitle") : t("forwards.form.newTitle")
      }
    >
      {open && (
        <ForwardFormBody
          key={forward?.id ?? "new"}
          forward={forward}
          onClose={onClose}
        />
      )}
    </FormDialog>
  );
}

function ForwardFormBody({
  forward,
  onClose,
}: {
  forward: PortForward | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: hosts = [] } = useHosts();
  const createForward = useCreateForward();
  const updateForward = useUpdateForward();

  const [label, setLabel] = useState(forward?.label ?? "");
  const [hostId, setHostId] = useState(forward?.hostId ?? "");
  const [kind, setKind] = useState<ForwardKind>(forward?.kind ?? "local");
  const [bindHost, setBindHost] = useState(forward?.bindHost ?? "");
  const [bindPort, setBindPort] = useState(String(forward?.bindPort ?? ""));
  const [targetHost, setTargetHost] = useState(forward?.targetHost ?? "");
  const [targetPort, setTargetPort] = useState(
    forward?.targetPort ? String(forward.targetPort) : "",
  );
  const [autoStart, setAutoStart] = useState(Boolean(forward?.autoStart));
  const [publicSocksInput, setPublicSocksInput] =
    useState<PortForwardInput | null>(null);

  const save = async (input: PortForwardInput) => {
    try {
      if (forward) {
        await updateForward.mutateAsync({
          id: forward.id,
          input,
        });
      } else {
        await createForward.mutateAsync(input);
      }
      onClose();
      return true;
    } catch (err) {
      toast.error(t("forwards.form.saveError"), errorMessage(err));
      return false;
    }
  };

  const submit = async () => {
    const result = forwardInput({
      hostId,
      label,
      kind,
      bindHost,
      bindPort,
      targetHost,
      targetPort,
      autoStart,
    });
    if (!("input" in result)) {
      return toast.error(t(`forwards.form.${result.error}`));
    }
    if (
      result.input.kind === "dynamic" &&
      !isLoopbackBindHost(result.input.bindHost ?? "127.0.0.1")
    ) {
      setPublicSocksInput(result.input);
      return;
    }
    await save(result.input);
  };

  const publicSocksPending = createForward.isPending || updateForward.isPending;

  return (
    <>
      <FormBody
        onClose={onClose}
        onSubmit={submit}
        submitLabel={forward ? t("common.saveChanges") : t("common.create")}
        pending={publicSocksPending}
      >
        <div className="space-y-2">
          <SegmentedControl
            value={kind}
            onChange={setKind}
            options={[
              { value: "local", label: t("forwards.kind.local") },
              { value: "remote", label: t("forwards.kind.remote") },
              { value: "dynamic", label: t("forwards.kind.dynamic") },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {t(`forwards.kindHint.${kind}`)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("forwards.label")} required>
            <Input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t(`forwards.labelPlaceholder.${kind}`)}
            />
          </Field>
          <Field label={t("forwards.host")} required>
            <Select
              value={hostId}
              onValueChange={setHostId}
              options={[
                { value: "", label: t("forwards.selectHost") },
                ...hosts.map((host) => ({
                  value: host.id,
                  label: host.label,
                })),
              ]}
            />
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field
            label={t("forwards.bindHost")}
            hint={
              kind === "dynamic" &&
              !isLoopbackBindHost(bindHost.trim() || defaultBindHost(kind))
                ? t("forwards.form.publicSocks.hint")
                : undefined
            }
          >
            <Input
              value={bindHost}
              onChange={(e) => setBindHost(e.target.value)}
              placeholder={defaultBindHost(kind)}
            />
          </Field>
          <Field label={t("forwards.bindPort")} required>
            <Input
              type="number"
              min={1}
              max={65535}
              value={bindPort}
              onChange={(e) => setBindPort(e.target.value)}
              placeholder="1-65535"
            />
          </Field>
        </div>

        {kind !== "dynamic" && (
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label={t("forwards.targetHost")} required>
              <Input
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
                placeholder={t("forwards.targetHostPlaceholder")}
              />
            </Field>
            <Field label={t("forwards.targetPort")} required>
              <Input
                type="number"
                min={1}
                max={65535}
                value={targetPort}
                onChange={(e) => setTargetPort(e.target.value)}
                placeholder="1-65535"
              />
            </Field>
          </div>
        )}

        <SwitchField
          label={t("forwards.autoStart")}
          checked={autoStart}
          onCheckedChange={setAutoStart}
        />
      </FormBody>
      <ConfirmDialog
        state={
          publicSocksInput
            ? {
                title: t("forwards.form.publicSocks.title"),
                description: t("forwards.form.publicSocks.description", {
                  endpoint: formatForwardEndpoint(
                    publicSocksInput.bindHost ?? "127.0.0.1",
                    publicSocksInput.bindPort,
                  ),
                }),
                cancelLabel: t("forwards.form.publicSocks.cancel"),
                actions: [
                  {
                    label: t("forwards.form.publicSocks.action"),
                    loading: publicSocksPending,
                    onSelect: async () =>
                      (await save(publicSocksInput)) || false,
                  },
                ],
              }
            : null
        }
        onClose={() => setPublicSocksInput(null)}
      />
    </>
  );
}
