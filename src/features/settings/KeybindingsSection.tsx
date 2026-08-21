import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search, Unlink } from "lucide-react";

import { Button, Input, Kbd, SectionHeader, Tooltip } from "@/components/ui";
import { INTERACTIVE_FOCUS_CLASS } from "@/components/ui/styles";
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
  platformKeybindingDefaults,
  type KeybindingId,
} from "@/workbench/keybinding-registry";
import { useKeybindingStore } from "@/workbench/keybinding-store";

interface PendingKeybinding {
  id: KeybindingId;
  binding: string;
  conflictId: KeybindingId;
  operation: "assign" | "reset";
}

export function KeybindingsSection() {
  const { t } = useI18n();
  const overrides = useKeybindingStore((state) => state.overrides);
  const setBinding = useKeybindingStore((state) => state.set);
  const replaceBinding = useKeybindingStore((state) => state.replace);
  const removeBindingConflict = useKeybindingStore(
    (state) => state.removeConflict,
  );
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

  const reset = (
    id: KeybindingId,
    currentOverrides: typeof overrides = overrides,
  ) => {
    for (const defaultBinding of platformKeybindingDefaults(id, IS_MACOS)) {
      const conflictId = findKeybindingConflict(
        id,
        defaultBinding,
        currentOverrides,
        IS_MACOS,
      );
      if (conflictId) {
        setPending({
          id,
          binding: defaultBinding,
          conflictId,
          operation: "reset",
        });
        return;
      }
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
        setPending({
          id: editingId,
          binding,
          conflictId,
          operation: "assign",
        });
        setEditingId(null);
        setInvalidId(null);
        return;
      }

      setBinding(editingId, binding, IS_MACOS);
      setEditingId(null);
      setInvalidId(null);
      setPending(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [disableBinding, editingId, overrides, setBinding]);

  return (
    <div className="flex flex-col gap-6">
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
            <div className="ui-divided-list">
              {definitions.map((definition) => {
                const bindings = effectiveKeybindings(
                  definition.id,
                  overrides,
                  IS_MACOS,
                );
                const binding = bindings[0];
                const editing = editingId === definition.id;
                const conflict = pending?.id === definition.id ? pending : null;
                const overridden = Object.prototype.hasOwnProperty.call(
                  overrides,
                  definition.id,
                );
                const label = t(definition.labelKey, definition.labelParams);

                return (
                  <div key={definition.id} className="last:border-b-0">
                    <div className="flex min-h-[var(--settings-row-height)] items-center gap-3 px-3 py-2">
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
                          "flex h-[var(--control-height-sm)] min-w-36 items-center justify-center rounded-md border px-2 text-xs transition-colors",
                          INTERACTIVE_FOCUS_CLASS,
                          editing
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border-strong bg-surface hover:bg-muted",
                        )}
                      >
                        {editing ? (
                          t("settings.keybindings.recording")
                        ) : conflict ? (
                          <Kbd keys={keybindingKeys(conflict.binding)} />
                        ) : binding ? (
                          <span className="flex flex-wrap items-center justify-center gap-1.5">
                            {bindings.map((item, index) => (
                              <span
                                key={item}
                                className="inline-flex items-center gap-1.5"
                              >
                                {index > 0 && (
                                  <span
                                    aria-hidden="true"
                                    className="text-muted-foreground"
                                  >
                                    /
                                  </span>
                                )}
                                <Kbd keys={keybindingKeys(item)} />
                              </span>
                            ))}
                          </span>
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
                            if (conflict.operation === "reset") {
                              removeBindingConflict(
                                conflict.binding,
                                conflict.conflictId,
                                IS_MACOS,
                              );
                              reset(
                                conflict.id,
                                useKeybindingStore.getState().overrides,
                              );
                              return;
                            }
                            replaceBinding(
                              conflict.id,
                              conflict.binding,
                              conflict.conflictId,
                              IS_MACOS,
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
