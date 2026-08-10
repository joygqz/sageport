import type { TKey, TParams } from "@/i18n/translate";

interface KeybindingDefinition {
  id: KeybindingId;
  categoryKey: TKey;
  labelKey: TKey;
  labelParams?: TParams;
  defaultBindings: readonly string[];
}

export type KeybindingId =
  | "palette.quick"
  | "palette.commands"
  | "host.new"
  | "terminal.newLocal"
  | "terminal.toggleBroadcast"
  | "terminal.splitRight"
  | "terminal.splitDown"
  | "terminal.focusPreviousPane"
  | "terminal.focusNextPane"
  | "terminal.search"
  | "terminal.copy"
  | "terminal.paste"
  | "view.toggleSidebar"
  | "view.togglePanel"
  | "view.toggleAssistant"
  | "tab.close"
  | "tab.previous"
  | "tab.next"
  | "tab.activate.1"
  | "tab.activate.2"
  | "tab.activate.3"
  | "tab.activate.4"
  | "tab.activate.5"
  | "tab.activate.6"
  | "tab.activate.7"
  | "tab.activate.8"
  | "tab.activate.9"
  | "settings.open"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset";

const tabActivationDefinitions: KeybindingDefinition[] = Array.from(
  { length: 9 },
  (_, index) => {
    const number = index + 1;
    return {
      id: `tab.activate.${number}` as KeybindingId,
      categoryKey: "commands.category.view",
      labelKey: "commands.tab.activate",
      labelParams: { number },
      defaultBindings: [`mod+${number}`],
    };
  },
);

export const KEYBINDING_DEFINITIONS: readonly KeybindingDefinition[] = [
  {
    id: "palette.quick",
    categoryKey: "commands.category.view",
    labelKey: "commands.palette.quick",
    defaultBindings: ["mod+p"],
  },
  {
    id: "palette.commands",
    categoryKey: "commands.category.view",
    labelKey: "commands.palette.commands",
    defaultBindings: ["mod+shift+p"],
  },
  {
    id: "host.new",
    categoryKey: "commands.category.hosts",
    labelKey: "commands.host.new",
    defaultBindings: ["mod+n"],
  },
  {
    id: "terminal.newLocal",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.newLocal",
    defaultBindings: ["mod+shift+t"],
  },
  {
    id: "terminal.toggleBroadcast",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.toggleBroadcast",
    defaultBindings: ["mod+shift+b"],
  },
  {
    id: "terminal.splitRight",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.splitRight",
    defaultBindings: ["mod+\\"],
  },
  {
    id: "terminal.splitDown",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.splitDown",
    defaultBindings: ["mod+shift+\\"],
  },
  {
    id: "terminal.focusPreviousPane",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.focusPreviousPane",
    defaultBindings: ["mod+["],
  },
  {
    id: "terminal.focusNextPane",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.focusNextPane",
    defaultBindings: ["mod+]"],
  },
  {
    id: "terminal.search",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.search",
    defaultBindings: ["mod+f"],
  },
  {
    id: "terminal.copy",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.copy",
    defaultBindings: ["ctrl+shift+c"],
  },
  {
    id: "terminal.paste",
    categoryKey: "commands.category.terminal",
    labelKey: "commands.terminal.paste",
    defaultBindings: ["ctrl+shift+v"],
  },
  {
    id: "view.toggleSidebar",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.toggleSidebar",
    defaultBindings: ["mod+b"],
  },
  {
    id: "view.togglePanel",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.togglePanel",
    defaultBindings: ["mod+j"],
  },
  {
    id: "view.toggleAssistant",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.toggleAssistant",
    defaultBindings: ["mod+l"],
  },
  {
    id: "tab.close",
    categoryKey: "commands.category.view",
    labelKey: "commands.tab.close",
    defaultBindings: ["mod+w"],
  },
  {
    id: "tab.previous",
    categoryKey: "commands.category.view",
    labelKey: "commands.tab.previous",
    defaultBindings: ["mod+shift+["],
  },
  {
    id: "tab.next",
    categoryKey: "commands.category.view",
    labelKey: "commands.tab.next",
    defaultBindings: ["mod+shift+]"],
  },
  ...tabActivationDefinitions,
  {
    id: "settings.open",
    categoryKey: "commands.category.preferences",
    labelKey: "commands.settings.open",
    defaultBindings: ["mod+,"],
  },
  {
    id: "view.zoomIn",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.zoomIn",
    defaultBindings: ["mod+=", "mod+shift+="],
  },
  {
    id: "view.zoomOut",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.zoomOut",
    defaultBindings: ["mod+-", "mod+shift+-"],
  },
  {
    id: "view.zoomReset",
    categoryKey: "commands.category.view",
    labelKey: "commands.view.zoomReset",
    defaultBindings: ["mod+0"],
  },
];

export const KEYBINDING_IDS = new Set<KeybindingId>(
  KEYBINDING_DEFINITIONS.map((definition) => definition.id),
);

const KEYBINDING_BY_ID = new Map(
  KEYBINDING_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const MODIFIERS = new Set(["mod", "ctrl", "alt", "shift"]);
const NAMED_KEYS = new Set([
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowup",
  "backspace",
  "delete",
  "end",
  "enter",
  "home",
  "insert",
  "pagedown",
  "pageup",
  "space",
  "tab",
]);
const PUNCTUATION_KEYS = new Set([
  "`",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
]);

interface ParsedKeybinding {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type KeybindingOverrides = Partial<Record<KeybindingId, string | null>>;

export function parseKeybinding(value: string): ParsedKeybinding | null {
  const tokens = value.split("+");
  if (tokens.length < 2) return null;
  const key = tokens.at(-1) ?? "";
  const modifiers = tokens.slice(0, -1);
  if (
    modifiers.some((modifier) => !MODIFIERS.has(modifier)) ||
    new Set(modifiers).size !== modifiers.length ||
    (!modifiers.includes("mod") &&
      !modifiers.includes("ctrl") &&
      !modifiers.includes("alt"))
  ) {
    return null;
  }
  const validKey =
    /^[a-z0-9]$/.test(key) ||
    /^f(?:[1-9]|1\d|2[0-4])$/.test(key) ||
    PUNCTUATION_KEYS.has(key) ||
    NAMED_KEYS.has(key);
  if (!validKey) return null;

  return {
    key,
    mod: modifiers.includes("mod"),
    ctrl: modifiers.includes("ctrl"),
    alt: modifiers.includes("alt"),
    shift: modifiers.includes("shift"),
  };
}

export function effectiveKeybindings(
  id: KeybindingId,
  overrides: KeybindingOverrides,
): readonly string[] {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) {
    const override = overrides[id];
    return override ? [override] : [];
  }
  return KEYBINDING_BY_ID.get(id)?.defaultBindings ?? [];
}

export function keybindingKeys(value: string): string[] {
  const parsed = parseKeybinding(value);
  if (!parsed) return [];
  return [
    ...(parsed.mod ? ["mod"] : []),
    ...(parsed.ctrl ? ["ctrl"] : []),
    ...(parsed.alt ? ["alt"] : []),
    ...(parsed.shift ? ["shift"] : []),
    parsed.key,
  ];
}

export function keybindingDisplayKeys(
  id: KeybindingId,
  overrides: KeybindingOverrides,
): string[] | undefined {
  const binding = effectiveKeybindings(id, overrides)[0];
  return binding ? keybindingKeys(binding) : undefined;
}

function keyboardEventKey(event: KeyboardEvent): string {
  const codeKeys: Record<string, string> = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  if (codeKeys[event.code]) return codeKeys[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  const shiftedKeys: Record<string, string> = {
    _: "-",
    "+": "=",
    "{": "[",
    "}": "]",
    "|": "\\",
    ":": ";",
    '"': "'",
    "<": ",",
    ">": ".",
    "?": "/",
    "~": "`",
  };
  if (shiftedKeys[event.key]) return shiftedKeys[event.key];
  if (event.key === " ") return "space";
  return event.key.toLowerCase();
}

export function keybindingFromKeyboardEvent(
  event: KeyboardEvent,
  isMacOS: boolean,
): string | null {
  const key = keyboardEventKey(event);
  if (
    MODIFIERS.has(key) ||
    (!/^[a-z0-9]$/.test(key) &&
      !/^f(?:[1-9]|1\d|2[0-4])$/.test(key) &&
      !PUNCTUATION_KEYS.has(key) &&
      !NAMED_KEYS.has(key))
  ) {
    return null;
  }
  const modifiers = [
    ...(isMacOS && event.metaKey
      ? ["mod"]
      : !isMacOS && event.ctrlKey
        ? ["mod"]
        : []),
    ...(isMacOS && event.ctrlKey ? ["ctrl"] : []),
    ...(event.altKey ? ["alt"] : []),
    ...(event.shiftKey ? ["shift"] : []),
  ];
  if (
    modifiers.length === 0 ||
    (!modifiers.includes("mod") &&
      !modifiers.includes("ctrl") &&
      !modifiers.includes("alt"))
  ) {
    return null;
  }
  return [...modifiers, key].join("+");
}

export function matchesKeybinding(
  event: KeyboardEvent,
  value: string,
  isMacOS: boolean,
): boolean {
  const parsed = parseKeybinding(value);
  if (!parsed || keyboardEventKey(event) !== parsed.key) return false;
  const expectedMeta = isMacOS && parsed.mod;
  const expectedCtrl = parsed.ctrl || (!isMacOS && parsed.mod);
  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

export function findKeybinding(
  event: KeyboardEvent,
  overrides: KeybindingOverrides,
  isMacOS: boolean,
): KeybindingId | null {
  for (const definition of KEYBINDING_DEFINITIONS) {
    if (
      effectiveKeybindings(definition.id, overrides).some((binding) =>
        matchesKeybinding(event, binding, isMacOS),
      )
    ) {
      return definition.id;
    }
  }
  return null;
}

function platformKeybindingSignature(value: string, isMacOS: boolean): string {
  const parsed = parseKeybinding(value);
  if (!parsed) return value;
  return [
    parsed.mod ? (isMacOS ? "meta" : "ctrl") : "",
    parsed.ctrl ? "ctrl" : "",
    parsed.alt ? "alt" : "",
    parsed.shift ? "shift" : "",
    parsed.key,
  ]
    .filter(Boolean)
    .join("+");
}

function keybindingsMatch(
  left: string,
  right: string,
  isMacOS: boolean,
): boolean {
  return (
    platformKeybindingSignature(left, isMacOS) ===
    platformKeybindingSignature(right, isMacOS)
  );
}

export function keybindingOverrideWithoutConflict(
  id: KeybindingId,
  value: string,
  overrides: KeybindingOverrides,
  isMacOS: boolean,
): string | null {
  return (
    effectiveKeybindings(id, overrides).find(
      (binding) => !keybindingsMatch(binding, value, isMacOS),
    ) ?? null
  );
}

export function findKeybindingConflict(
  id: KeybindingId,
  value: string,
  overrides: KeybindingOverrides,
  isMacOS: boolean,
): KeybindingId | null {
  const signature = platformKeybindingSignature(value, isMacOS);
  for (const definition of KEYBINDING_DEFINITIONS) {
    if (definition.id === id) continue;
    if (
      effectiveKeybindings(definition.id, overrides).some(
        (binding) =>
          platformKeybindingSignature(binding, isMacOS) === signature,
      )
    ) {
      return definition.id;
    }
  }
  return null;
}

export function keybindingDefinition(id: KeybindingId): KeybindingDefinition {
  return KEYBINDING_BY_ID.get(id) as KeybindingDefinition;
}

export function parseKeybindingOverrides(
  value: unknown,
): KeybindingOverrides | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const overrides: KeybindingOverrides = {};
  for (const [id, binding] of Object.entries(value)) {
    if (!KEYBINDING_IDS.has(id as KeybindingId)) return null;
    if (
      binding !== null &&
      (typeof binding !== "string" || !parseKeybinding(binding))
    ) {
      return null;
    }
    overrides[id as KeybindingId] = binding;
  }
  return overrides;
}

export function serializeKeybindingOverrides(
  overrides: KeybindingOverrides,
): string {
  const entries = KEYBINDING_DEFINITIONS.flatMap(({ id }) =>
    Object.prototype.hasOwnProperty.call(overrides, id)
      ? [[id, overrides[id]] as const]
      : [],
  );
  return JSON.stringify(Object.fromEntries(entries));
}

export function deserializeKeybindingOverrides(
  value: string,
): KeybindingOverrides {
  try {
    return parseKeybindingOverrides(JSON.parse(value)) ?? {};
  } catch {
    return {};
  }
}
