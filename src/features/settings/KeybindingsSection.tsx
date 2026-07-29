import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, Unlink } from "lucide-react";

import { Button, Input, Kbd, SectionHeader, Tooltip } from "@/components/ui";
import { useI18n } from "@/i18n";
import { IS_MACOS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  effectiveKeybindings,
  findKeybindingConflict,
  keybindingDefinition,
  keybindingFromKeyboardEvent,
  keybindingKeys,
  KEYBINDING_DEFINITIONS,
  type KeybindingId,
} from "@/workbench/keybinding-registry";
import { useKeybindingStore } from "@/workbench/keybinding-store";

interface PendingKeybinding {
  id: KeybindingId;
  binding: string;
  conflictId: KeybindingId;
}

export function KeybindingsSection() {
  const { t } = useI18n();
  const overrides = useKeybindingStore((state) => state.overrides);
  const setBinding = useKeybindingStore((state) => state.set);
  const replaceBinding = useKeybindingStore((state) => state.replace);
  const disableBinding = useKeybindingStore((state) => state.disable);
  const resetBinding = useKeybindingStore((state) => state.reset);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<KeybindingId | null>(null);
  const [invalidId, setInvalidId] = useState<KeybindingId | null>(null);
  const [pending, setPending] = useState<PendingKeybinding | null>(null);

  const visibleDefinitions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return KEYBINDING_DEFINITIONS;
    return KEYBINDING_DEFINITIONS.filter((definition) => {
      const label = t(definition.labelKey, definition.labelParams);
      const category = t(definition.categoryKey);
      return `${category} ${label}`.toLocaleLowerCase().includes(normalized);
    });
  }, [query, t]);

  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      (typeof KEYBINDING_DEFINITIONS)[number][]
    >();
    for (const definition of visibleDefinitions) {
      const definitions = grouped.get(definition.categoryKey) ?? [];
      definitions.push(definition);
      grouped.set(definition.categoryKey, definitions);
    }
    return grouped;
  }, [visibleDefinitions]);

  const cancelRecording = () => {
    setEditingId(null);
    setInvalidId(null);
    setPending(null);
  };

  const reset = (id: KeybindingId) => {
    const defaultBinding = keybindingDefinition(id).defaultBindings[0];
    const conflictId = findKeybindingConflict(
      id,
      defaultBinding,
      overrides,
      IS_MACOS,
    );
    if (conflictId) {
      setPending({ id, binding: defaultBinding, conflictId });
      return;
    }
    resetBinding(id);
    cancelRecording();
  };

  useEffect(() => {
    if (!editingId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "Escape") {
        setEditingId(null);
        setInvalidId(null);
        setPending(null);
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        disableBinding(editingId);
        setEditingId(null);
        setInvalidId(null);
        setPending(null);
        return;
      }

      const binding = keybindingFromKeyboardEvent(event, IS_MACOS);
      if (!binding) {
        setInvalidId(editingId);
        return;
      }
      const conflictId = findKeybindingConflict(
        editingId,
        binding,
        overrides,
        IS_MACOS,
      );
      if (conflictId) {
        setPending({ id: editingId, binding, conflictId });
        setEditingId(null);
        setInvalidId(null);
        return;
      }

      setBinding(editingId, binding);
      setEditingId(null);
      setInvalidId(null);
      setPending(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [disableBinding, editingId, overrides, setBinding]);

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.keybindings.search")}
          aria-label={t("settings.keybindings.search")}
          className="pl-9"
        />
      </div>

      {visibleDefinitions.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("settings.keybindings.noResults")}
        </p>
      ) : (
        [...groups.entries()].map(([categoryKey, definitions]) => (
          <section key={categoryKey} className="flex flex-col gap-2">
            <SectionHeader
              title={t(
                categoryKey as (typeof definitions)[number]["categoryKey"],
              )}
            />
            <div className="overflow-hidden rounded-lg border border-border">
              {definitions.map((definition) => {
                const bindings = effectiveKeybindings(definition.id, overrides);
                const binding = bindings[0];
                const editing = editingId === definition.id;
                const conflict = pending?.id === definition.id ? pending : null;
                const overridden = Object.prototype.hasOwnProperty.call(
                  overrides,
                  definition.id,
                );
                const label = t(definition.labelKey, definition.labelParams);

                return (
                  <div
                    key={definition.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm">{label}</span>
                      <button
                        type="button"
                        autoFocus={editing}
                        onClick={() => {
                          setEditingId(definition.id);
                          setInvalidId(null);
                          setPending(null);
                        }}
                        onBlur={() => editing && cancelRecording()}
                        aria-label={t("settings.keybindings.change", {
                          command: label,
                        })}
                        className={cn(
                          "flex h-8 min-w-36 items-center justify-center rounded-md border px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                          editing
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-input bg-background hover:bg-muted",
                        )}
                      >
                        {editing ? (
                          t("settings.keybindings.recording")
                        ) : conflict ? (
                          <Kbd keys={keybindingKeys(conflict.binding)} />
                        ) : binding ? (
                          <Kbd keys={keybindingKeys(binding)} />
                        ) : (
                          <span className="text-muted-foreground">
                            {t("settings.keybindings.unassigned")}
                          </span>
                        )}
                      </button>
                      <Tooltip content={t("settings.keybindings.disable")}>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("settings.keybindings.disableCommand", {
                            command: label,
                          })}
                          disabled={!binding && !conflict}
                          onClick={() => {
                            disableBinding(definition.id);
                            cancelRecording();
                          }}
                        >
                          <Unlink />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("settings.keybindings.reset")}>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("settings.keybindings.resetCommand", {
                            command: label,
                          })}
                          disabled={!overridden}
                          onClick={() => reset(definition.id)}
                        >
                          <RotateCcw />
                        </Button>
                      </Tooltip>
                    </div>
                    {invalidId === definition.id && (
                      <p
                        role="alert"
                        className="border-t border-border bg-danger/5 px-3 py-2 text-xs text-danger"
                      >
                        {t("settings.keybindings.invalid")}
                      </p>
                    )}
                    {conflict && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-warning/5 px-3 py-2">
                        <p role="alert" className="min-w-0 flex-1 text-xs">
                          {t("settings.keybindings.conflict", {
                            command: t(
                              keybindingDefinition(conflict.conflictId)
                                .labelKey,
                              keybindingDefinition(conflict.conflictId)
                                .labelParams,
                            ),
                          })}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelRecording}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            replaceBinding(
                              conflict.id,
                              conflict.binding,
                              conflict.conflictId,
                            );
                            cancelRecording();
                          }}
                        >
                          {t("settings.keybindings.replace")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
