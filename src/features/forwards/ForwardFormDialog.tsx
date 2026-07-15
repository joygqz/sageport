import { useState } from "react";

import {
  Field,
  FormBody,
  FormDialog,
  Input,
  SegmentedControl,
  Select,
  Switch,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { ForwardKind, PortForward } from "@/types/models";
import { useHosts } from "@/features/hosts/api";
import { useCreateForward, useUpdateForward } from "./api";
import { forwardInput } from "./forwardForm";

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
      <ForwardFormBody forward={forward} onClose={onClose} />
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
  const [bindHost, setBindHost] = useState(forward?.bindHost ?? "127.0.0.1");
  const [bindPort, setBindPort] = useState(String(forward?.bindPort ?? ""));
  const [targetHost, setTargetHost] = useState(forward?.targetHost ?? "");
  const [targetPort, setTargetPort] = useState(
    forward?.targetPort ? String(forward.targetPort) : "",
  );
  const [autoStart, setAutoStart] = useState(Boolean(forward?.autoStart));

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
    try {
      if (forward) {
        await updateForward.mutateAsync({
          id: forward.id,
          input: result.input,
        });
      } else {
        await createForward.mutateAsync(result.input);
      }
      onClose();
    } catch (err) {
      toast.error(t("forwards.form.saveError"), errorMessage(err));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={forward ? t("common.saveChanges") : t("common.create")}
      pending={createForward.isPending || updateForward.isPending}
    >
      <SegmentedControl
        value={kind}
        onChange={setKind}
        options={[
          { value: "local", label: t("forwards.kind.local") },
          { value: "dynamic", label: t("forwards.kind.dynamic") },
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("forwards.label")} required>
          <Input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("forwards.labelPlaceholder")}
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
        <Field label={t("forwards.bindHost")}>
          <Input
            value={bindHost}
            onChange={(e) => setBindHost(e.target.value)}
            placeholder="127.0.0.1"
          />
        </Field>
        <Field label={t("forwards.bindPort")} required>
          <Input
            type="number"
            min={1}
            max={65535}
            value={bindPort}
            onChange={(e) => setBindPort(e.target.value)}
          />
        </Field>
      </div>

      {kind === "local" && (
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
            />
          </Field>
        </div>
      )}

      <label className="flex items-center justify-between gap-2 text-sm">
        <span>{t("forwards.autoStart")}</span>
        <Switch checked={autoStart} onCheckedChange={setAutoStart} />
      </label>
    </FormBody>
  );
}
