import { create } from "zustand";

import {
  deserializeKeybindingOverrides,
  keybindingDefinition,
  serializeKeybindingOverrides,
  type KeybindingId,
  type KeybindingOverrides,
} from "./keybinding-registry";

export const KEYBINDINGS_SYNC_KEY = "general.keybindings";

interface KeybindingState {
  overrides: KeybindingOverrides;
  replaceOverrides: (overrides: KeybindingOverrides) => void;
  load: (value: string) => void;
  set: (id: KeybindingId, binding: string) => void;
  replace: (
    id: KeybindingId,
    binding: string,
    conflictId: KeybindingId,
  ) => void;
  disable: (id: KeybindingId) => void;
  reset: (id: KeybindingId) => void;
}

function assign(
  overrides: KeybindingOverrides,
  id: KeybindingId,
  binding: string,
): KeybindingOverrides {
  const next = { ...overrides };
  if (keybindingDefinition(id).defaultBindings.includes(binding)) {
    delete next[id];
  } else {
    next[id] = binding;
  }
  return next;
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  overrides: {},
  replaceOverrides: (overrides) => set({ overrides }),
  load: (value) => set({ overrides: deserializeKeybindingOverrides(value) }),
  set: (id, binding) =>
    set((state) => ({ overrides: assign(state.overrides, id, binding) })),
  replace: (id, binding, conflictId) =>
    set((state) => ({
      overrides: assign(
        { ...state.overrides, [conflictId]: null },
        id,
        binding,
      ),
    })),
  disable: (id) =>
    set((state) => ({
      overrides: { ...state.overrides, [id]: null },
    })),
  reset: (id) =>
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[id];
      return { overrides };
    }),
}));

export function serializedKeybindingOverrides(): string {
  return serializeKeybindingOverrides(useKeybindingStore.getState().overrides);
}
