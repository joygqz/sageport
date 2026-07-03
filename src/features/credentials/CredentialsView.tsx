import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  User,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type { Identity, SshKey } from "@/types/models";
import { SideBarView } from "@/workbench/SideBarView";
import {
  useDeleteIdentity,
  useDeleteSshKey,
  useIdentities,
  useSshKeys,
} from "./api";
import { IdentityFormDialog } from "./IdentityFormDialog";
import { KeyFormDialog } from "./KeyFormDialog";

/**
 * Credentials view: SSH keys and reusable identities in two collapsible
 * sections. Identities bundle a username with an authentication method so
 * many hosts can share one login.
 */
export function CredentialsView() {
  const { t } = useI18n();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [identityForm, setIdentityForm] = useState<{
    open: boolean;
    identity: Identity | null;
  }>({ open: false, identity: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  return (
    <SideBarView title={t("credentials.viewTitle")}>
      <Section
        title={t("credentials.keys.sectionTitle")}
        onAdd={() => setKeyFormOpen(true)}
        addLabel={t("credentials.keys.add")}
      >
        <KeyList setConfirmState={setConfirmState} />
      </Section>

      <Section
        title={t("credentials.identities.sectionTitle")}
        onAdd={() => setIdentityForm({ open: true, identity: null })}
        addLabel={t("credentials.identities.add")}
      >
        <IdentityList
          setConfirmState={setConfirmState}
          onEdit={(identity) => setIdentityForm({ open: true, identity })}
        />
      </Section>

      <KeyFormDialog open={keyFormOpen} onClose={() => setKeyFormOpen(false)} />
      <IdentityFormDialog
        open={identityForm.open}
        identity={identityForm.identity}
        onClose={() => setIdentityForm((s) => ({ ...s, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </SideBarView>
  );
}

function Section({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-1 px-1">
      <div className="group flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-list-hover hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{title}</span>
        </button>
        <Tooltip content={addLabel}>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 opacity-0 group-hover:opacity-100"
            onClick={onAdd}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      </div>
      {!collapsed && children}
    </div>
  );
}

/** Short algorithm tag parsed from the OpenSSH public key line. */
function algorithmTag(publicKey: string | null): string | null {
  const token = publicKey?.trim().split(/\s+/)[0];
  if (!token) return null;
  return token.replace(/^ssh-/, "").replace(/^ecdsa-sha2-nistp/, "ecdsa-p");
}

function KeyList({
  setConfirmState,
}: {
  setConfirmState: (state: ConfirmState) => void;
}) {
  const { t } = useI18n();
  const { data: keys = [] } = useSshKeys();
  const deleteKey = useDeleteSshKey();

  const requestDelete = (key: SshKey) => {
    setConfirmState({
      title: t("credentials.keys.delete.title"),
      description: t("credentials.keys.delete.description", { name: key.name }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () =>
            void deleteKey.mutateAsync(key.id).catch((err) => {
              toast.error(
                t("credentials.keys.delete.error"),
                errorCode(err) === "in_use"
                  ? t("credentials.keys.delete.inUse")
                  : errorMessage(err),
              );
            }),
        },
      ],
    });
  };

  if (keys.length === 0) {
    return <SectionEmpty text={t("credentials.keys.empty")} />;
  }

  return (
    <div className="pb-2">
      {keys.map((key) => (
        <KeyRow key={key.id} sshKey={key} onDelete={() => requestDelete(key)} />
      ))}
    </div>
  );
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group flex cursor-pointer items-center gap-2 rounded-md py-1 pl-6 pr-2 hover:bg-list-hover">
          <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm">{sshKey.name}</span>
          {tag && <Badge className="font-mono text-2xs uppercase">{tag}</Badge>}
          {sshKey.publicKey && (
            <Tooltip
              content={
                copied
                  ? t("common.copied")
                  : t("credentials.keys.copyPublicKey")
              }
            >
              <button
                onClick={copyPublicKey}
                className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </Tooltip>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {sshKey.publicKey && (
          <>
            <ContextMenuItem onSelect={() => void copyPublicKey()}>
              <Copy /> {t("credentials.keys.copyPublicKey")}
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash2 /> {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function IdentityList({
  setConfirmState,
  onEdit,
}: {
  setConfirmState: (state: ConfirmState) => void;
  onEdit: (identity: Identity) => void;
}) {
  const { t } = useI18n();
  const { data: identities = [] } = useIdentities();
  const deleteIdentity = useDeleteIdentity();

  const requestDelete = (identity: Identity) => {
    setConfirmState({
      title: t("credentials.identities.delete.title"),
      description: t("credentials.identities.delete.description", {
        name: identity.name,
      }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () =>
            void deleteIdentity.mutateAsync(identity.id).catch((err) => {
              toast.error(
                t("credentials.identities.delete.error"),
                errorCode(err) === "in_use"
                  ? t("credentials.identities.delete.inUse")
                  : errorMessage(err),
              );
            }),
        },
      ],
    });
  };

  if (identities.length === 0) {
    return <SectionEmpty text={t("credentials.identities.empty")} />;
  }

  return (
    <div className="pb-2">
      {identities.map((identity) => (
        <ContextMenu key={identity.id}>
          <ContextMenuTrigger asChild>
            <div
              onDoubleClick={() => onEdit(identity)}
              className="group flex cursor-pointer items-center gap-2 rounded-md py-1 pl-6 pr-2 hover:bg-list-hover"
            >
              <User className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{identity.name}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {identity.username} · {t(`common.auth.${identity.authType}`)}
              </span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onEdit(identity)}>
              <Pencil /> {t("common.edit")}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              destructive
              onSelect={() => requestDelete(identity)}
            >
              <Trash2 /> {t("common.delete")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}

function SectionEmpty({ text }: { text: string }) {
  return (
    <p className="px-6 py-2 text-xs leading-relaxed text-muted-foreground">
      {text}
    </p>
  );
}
