import { useState } from "react";

import { Field, FormBody, FormDialog, Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { SftpBookmark } from "@/types/models";
import { useUpdateBookmark } from "./api";

export function BookmarkRenameDialog({
  bookmark,
  onClose,
}: {
  bookmark: SftpBookmark | null;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <FormDialog
      open={bookmark !== null}
      onClose={onClose}
      width="w-[var(--dialog-width-sm)]"
      title={t("sftp.bookmarks.renameTitle")}
    >
      {bookmark && (
        <BookmarkRenameBody
          key={bookmark.id}
          bookmark={bookmark}
          onClose={onClose}
        />
      )}
    </FormDialog>
  );
}

function BookmarkRenameBody({
  bookmark,
  onClose,
}: {
  bookmark: SftpBookmark;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const updateBookmark = useUpdateBookmark();
  const [label, setLabel] = useState(bookmark.label);
  const normalized = label.trim();
  const hasControlCharacter = Array.from(label).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  const validationError = hasControlCharacter
    ? t("sftp.bookmarks.nameInvalid")
    : new TextEncoder().encode(normalized).byteLength > 255
      ? t("sftp.bookmarks.nameTooLong")
      : undefined;

  const submit = async () => {
    if (!normalized || validationError) return;
    try {
      await updateBookmark.mutateAsync({ id: bookmark.id, label });
      onClose();
    } catch (error) {
      toast.error(t("sftp.bookmarks.renameError"), errorMessage(error));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={t("sftp.bookmarks.renameAction")}
      submitDisabled={
        !normalized || normalized === bookmark.label || !!validationError
      }
      pending={updateBookmark.isPending}
    >
      <Field label={t("sftp.bookmarks.name")} error={validationError} required>
        <Input
          autoFocus
          value={label}
          maxLength={255}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
    </FormBody>
  );
}
