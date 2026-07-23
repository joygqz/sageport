import { useEffect, useRef, useState } from "react";

import { Input, PasswordInput, type PasswordInputProps } from "@/components/ui";

export function DraftInput({
  value,
  onCommit,
  password = false,
  onBeforeReveal,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (next: string) => void;
  password?: boolean;
  onBeforeReveal?: PasswordInputProps["onBeforeReveal"];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef({ draft, value, onCommit });

  useEffect(() => {
    pending.current = { draft, value, onCommit };
  });

  useEffect(
    () => () => {
      const { draft, value, onCommit } = pending.current;
      if (draft !== null && draft !== value) onCommit(draft);
    },
    [],
  );

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };

  const inputProps = {
    ...props,
    value: draft ?? value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft(event.target.value),
    onBlur: commit,
  };

  return password ? (
    <PasswordInput {...inputProps} onBeforeReveal={onBeforeReveal} />
  ) : (
    <Input {...inputProps} />
  );
}
