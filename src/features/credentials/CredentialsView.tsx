import { useMemo, useState } from "react";
import {
  Check,
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
  EmptyState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Identity, SshKey } from "@/types/models";
import {
  PanelContent,
  PanelSectionHeader,
  PANEL_LIST_ACTION_CLASS,
  PANEL_LIST_CLASS,
  PANEL_LIST_ITEM_CLASS,
} from "@/workbench/PanelHeader";
import { SideBarView } from "@/workbench/SideBarView";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import {
  useDeleteIdentity,
  useDeleteSshKey,
  useIdentities,
  useSshKeys,
} from "./api";
import { IdentityFormDialog } from "./IdentityFormDialog";
import { KeyFormDialog } from "./KeyFormDialog";

export function CredentialsView() {
  const { t } = useI18n();
  const { data: keys = [] } = useSshKeys();
  const { data: identities = [] } = useIdentities();
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [identityForm, setIdentityForm] = useState<{
    open: boolean;
    identity: Identity | null;
  }>({ open: false, identity: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const filteredKeys = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((key) =>
      [key.name, algorithmTag(key.publicKey) ?? ""].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [keys, query]);

  const filteredIdentities = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return identities;
    return identities.filter((identity) =>
      [identity.name, identity.username, identity.authType].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [identities, query]);

  const noMatches =
    searching && filteredKeys.length === 0 && filteredIdentities.length === 0;

  return (
    <SideBarView
      title={t("credentials.viewTitle")}
      topContent={
        <SideBarFilter
          itemCount={keys.length + identities.length}
          value={query}
          onChange={setQuery}
          placeholder={t("credentials.filterPlaceholder")}
          threshold={6}
        />
      }
    >
      <PanelContent className="space-y-[var(--panel-gutter)]">
        {noMatches ? (
          <EmptyState icon={KeyRound} title={t("credentials.noMatches")} />
        ) : (
          <>
            {(!searching || filteredKeys.length > 0) && (
              <Section
                title={t("credentials.keys.sectionTitle")}
                onAdd={() => setKeyFormOpen(true)}
                addLabel={t("credentials.keys.add")}
                forceExpanded={searching}
              >
                <KeyList
                  keys={filteredKeys}
                  setConfirmState={setConfirmState}
                />
              </Section>
            )}

            {(!searching || filteredIdentities.length > 0) && (
              <Section
                title={t("credentials.identities.sectionTitle")}
                onAdd={() => setIdentityForm({ open: true, identity: null })}
                addLabel={t("credentials.identities.add")}
                forceExpanded={searching}
              >
                <IdentityList
                  identities={filteredIdentities}
                  setConfirmState={setConfirmState}
                  onEdit={(identity) =>
                    setIdentityForm({ open: true, identity })
                  }
                />
              </Section>
            )}
          </>
        )}
      </PanelContent>

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
  forceExpanded = false,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  forceExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isCollapsed = collapsed && !forceExpanded;

  return (
    <section>
      <PanelSectionHeader
        title={title}
        collapsed={isCollapsed}
        onToggle={() => setCollapsed((c) => !c)}
        trailing={
          <Tooltip content={addLabel}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={onAdd}
            >
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        }
      />
      {!isCollapsed && children}
    </section>
  );
}

function algorithmTag(publicKey: string | null): string | null {
  const token = publicKey?.trim().split(/\s+/)[0];
  if (!token) return null;
  return token.replace(/^ssh-/, "").replace(/^ecdsa-sha2-nistp/, "ecdsa-p");
}

function KeyList({
  keys,
  setConfirmState,
}: {
  keys: SshKey[];
  setConfirmState: (state: ConfirmState) => void;
}) {
  const { t } = useI18n();
  const deleteKey = useDeleteSshKey();

  const requestDelete = (key: SshKey) => {
    setConfirmState({
      title: t("credentials.keys.delete.title"),
      description: t("common.deleteConfirm", { name: key.name }),
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
    <div className={PANEL_LIST_CLASS}>
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
        <div className={cn(PANEL_LIST_ITEM_CLASS, "cursor-pointer")}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-link shadow-sm">
            <KeyRound className="size-4" strokeWidth={1.7} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {sshKey.name}
            </p>
            <p className="text-2xs text-muted-foreground">
              {tag ? (
                <Badge className="h-4 py-0 font-mono uppercase">{tag}</Badge>
              ) : (
                t("credentials.keys.sectionTitle")
              )}
            </p>
          </div>
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
                className={cn(PANEL_LIST_ACTION_CLASS, "ml-auto")}
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
  identities,
  setConfirmState,
  onEdit,
}: {
  identities: Identity[];
  setConfirmState: (state: ConfirmState) => void;
  onEdit: (identity: Identity) => void;
}) {
  const { t } = useI18n();
  const deleteIdentity = useDeleteIdentity();

  const requestDelete = (identity: Identity) => {
    setConfirmState({
      title: t("credentials.identities.delete.title"),
      description: t("common.deleteConfirm", { name: identity.name }),
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
    <div className={PANEL_LIST_CLASS}>
      {identities.map((identity) => (
        <ContextMenu key={identity.id}>
          <ContextMenuTrigger asChild>
            <div
              onDoubleClick={() => onEdit(identity)}
              className={cn(PANEL_LIST_ITEM_CLASS, "cursor-pointer")}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-link shadow-sm">
                <User className="size-4" strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {identity.name}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  {identity.username} · {t(`common.auth.${identity.authType}`)}
                </p>
              </div>
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
    <p className="mt-[var(--panel-gutter)] rounded-lg border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
      {text}
    </p>
  );
}
