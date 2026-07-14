import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, Plug, Server } from "lucide-react";

import { Input, Kbd } from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { parseQuickConnect } from "@/features/terminal/quick-connect";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Host } from "@/types/models";
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
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-12 z-50 w-[36rem] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border/90 bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Command palette
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

  const [prevInput, setPrevInput] = useState(input);
  if (prevInput !== input) {
    setPrevInput(input);
    setIndex(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const run = (item: PaletteItem) => {
    onClose();
    if (item.type === "host") openTerminal(item.host);
    else if (item.type === "adhoc") openAdhocTerminal(item.target);
    else item.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[index];
      if (item) run(item);
    }
  };

  return (
    <div className="flex max-h-[24rem] flex-col">
      <div className="border-b border-border p-2">
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
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

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1">
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
              highlighted={i === index}
              onHover={() => setIndex(i)}
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
  highlighted,
  onHover,
  onSelect,
}: {
  item: PaletteItem;
  highlighted: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
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
            {item.target.username}@{item.target.host}
            {item.target.port === 22 ? "" : `:${item.target.port}`}
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
