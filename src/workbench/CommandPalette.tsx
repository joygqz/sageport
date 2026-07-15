import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, Plug, Server } from "lucide-react";

import { DialogOverlay, Input, Kbd } from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import {
  formatQuickConnectTarget,
  parseQuickConnect,
} from "@/features/terminal/quick-connect";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Host } from "@/types/models";
import {
  clampPaletteIndex,
  hasPointerMoved,
  movePaletteIndex,
} from "./command-palette-navigation";
import { useCommands, type WorkbenchCommand } from "./commands";
import { useTabsStore, type AdhocTarget } from "./tabs";

export function CommandPalette({
  open,
  initialMode,
  onClose,
}: {
  open: boolean;
  initialMode: "quick" | "commands";
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-12 z-50 w-[36rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border/90 bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {t("palette.title")}
          </DialogPrimitive.Title>
          {open && <PaletteBody initialMode={initialMode} onClose={onClose} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

type PaletteItem =
  | { type: "host"; host: Host }
  | { type: "command"; command: WorkbenchCommand }
  | { type: "adhoc"; target: AdhocTarget };

function PaletteBody({
  initialMode,
  onClose,
}: {
  initialMode: "quick" | "commands";
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState(initialMode === "commands" ? ">" : "");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const listId = useId();

  const { data: hosts = [] } = useHosts();
  const commands = useCommands();
  const openTerminal = useTabsStore((s) => s.openTerminal);
  const openAdhocTerminal = useTabsStore((s) => s.openAdhocTerminal);

  const commandMode = input.startsWith(">");
  const query = commandMode ? input.slice(1).trim() : input.trim();

  const items = useMemo<PaletteItem[]>(() => {
    if (commandMode) {
      return commands
        .filter(
          (c) =>
            fuzzyMatch(query, c.label) ||
            fuzzyMatch(query, `${t(c.categoryKey)} ${c.label}`),
        )
        .map((command) => ({ type: "command", command }));
    }
    const sorted = [...hosts].sort((a, b) =>
      (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""),
    );
    const matches: PaletteItem[] = sorted
      .filter(
        (h) =>
          fuzzyMatch(query, h.label) ||
          fuzzyMatch(query, h.address) ||
          fuzzyMatch(query, h.username ?? ""),
      )
      .map((host) => ({ type: "host", host }));
    const adhoc = parseQuickConnect(query);
    if (adhoc) matches.unshift({ type: "adhoc", target: adhoc });
    const quickActions = ["terminal.newLocal", "host.new"];
    for (const id of quickActions) {
      const command = commands.find((c) => c.id === id);
      if (command && fuzzyMatch(query, command.label))
        matches.push({ type: "command", command });
    }
    return matches;
  }, [commandMode, query, commands, hosts, t]);
  const safeIndex = clampPaletteIndex(index, items.length);

  useLayoutEffect(() => {
    const list = listRef.current;
    const highlighted = list?.querySelector<HTMLElement>(
      '[data-highlighted="true"]',
    );
    if (!list || !highlighted) return;

    const listRect = list.getBoundingClientRect();
    const highlightedRect = highlighted.getBoundingClientRect();
    if (highlightedRect.top < listRect.top) {
      list.scrollTop -= listRect.top - highlightedRect.top;
    } else if (highlightedRect.bottom > listRect.bottom) {
      list.scrollTop += highlightedRect.bottom - listRect.bottom;
    }
  }, [commandMode, query, safeIndex]);

  const run = (item: PaletteItem) => {
    onClose();
    if (item.type === "host") openTerminal(item.host);
    else if (item.type === "adhoc") openAdhocTerminal(item.target);
    else item.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => movePaletteIndex(i, 1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => movePaletteIndex(i, -1, items.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIndex(Math.max(items.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[safeIndex];
      if (item) run(item);
    }
  };

  return (
    <div className="flex max-h-[24rem] flex-col">
      <div className="border-b border-border p-2">
        <Input
          autoFocus
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={
            items.length > 0 ? `${listId}-option-${safeIndex}` : undefined
          }
          placeholder={
            commandMode
              ? t("palette.commandsPlaceholder")
              : t("palette.quickPlaceholder")
          }
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-8 bg-background px-2.5"
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto p-1"
      >
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {commandMode ? t("palette.noCommands") : t("palette.noHosts")}
          </p>
        ) : (
          items.map((item, i) => (
            <PaletteRow
              key={
                item.type === "host"
                  ? item.host.id
                  : item.type === "adhoc"
                    ? "adhoc"
                    : item.command.id
              }
              item={item}
              id={`${listId}-option-${i}`}
              highlighted={i === safeIndex}
              onHover={(event) => {
                const nextPosition = {
                  x: event.clientX,
                  y: event.clientY,
                };
                const previousPosition = pointerPositionRef.current;
                pointerPositionRef.current = nextPosition;
                const pointerMoved = hasPointerMoved(
                  previousPosition,
                  nextPosition,
                  { x: event.movementX, y: event.movementY },
                );

                if (!pointerMoved) return;
                setIndex(i);
              }}
              onSelect={() => run(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  id,
  highlighted,
  onHover,
  onSelect,
}: {
  item: PaletteItem;
  id: string;
  highlighted: boolean;
  onHover: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      id={id}
      role="option"
      aria-selected={highlighted}
      data-highlighted={highlighted}
      onPointerMove={onHover}
      onClick={onSelect}
      className={cn(
        "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none",
        highlighted
          ? "bg-list-active text-list-active-foreground"
          : "text-foreground",
      )}
    >
      {item.type === "host" ? (
        <>
          <Server className="size-4 shrink-0 opacity-70" />
          <span className="truncate font-medium">{item.host.label}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              highlighted ? "opacity-70" : "text-muted-foreground",
            )}
          >
            {item.host.username ? `${item.host.username}@` : ""}
            {item.host.address}
          </span>
        </>
      ) : item.type === "adhoc" ? (
        <>
          <Plug className="size-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{t("palette.quickConnect")} </span>
            {formatQuickConnectTarget(item.target)}
          </span>
        </>
      ) : (
        <>
          <ChevronRight className="size-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{t(item.command.categoryKey)}: </span>
            {item.command.label}
          </span>
          {item.command.shortcut && <Kbd keys={item.command.shortcut} />}
        </>
      )}
    </div>
  );
}
