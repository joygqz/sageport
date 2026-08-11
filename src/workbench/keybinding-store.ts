import { create } from "zustand";

import {
  deserializeKeybindingOverrides,
  keybindingOverrideWithoutConflict,
  platformKeybindingDefaults,
  serializeKeybindingOverrides,
  type KeybindingId,
  type KeybindingOverrides,
} from "./keybinding-registry";

export const KEYBINDINGS_SYNC_KEY = "general.keybindings";

interface KeybindingState {
  overrides: KeybindingOverrides;
  replaceOverrides: (overrides: KeybindingOverrides) => void;
  load: (value: string) => void;
  set: (id: KeybindingId, binding: string, isMacOS: boolean) => void;
  replace: (
    id: KeybindingId,
    binding: string,
    conflictId: KeybindingId,
    isMacOS: boolean,
  ) => void;
  removeConflict: (
    binding: string,
    conflictId: KeybindingId,
    isMacOS: boolean,
  ) => void;
  disable: (id: KeybindingId) => void;
  reset: (id: KeybindingId) => void;
}

function assign(
  overrides: KeybindingOverrides,
  id: KeybindingId,
  binding: string,
  isMacOS: boolean,
): KeybindingOverrides {
  const next = { ...overrides };
  if (platformKeybindingDefaults(id, isMacOS).includes(binding)) {
    delete next[id];
  } else {
    next[id] = binding;
  }
  return next;
}

function removeConflict(
  overrides: KeybindingOverrides,
  binding: string,
  conflictId: KeybindingId,
  isMacOS: boolean,
): KeybindingOverrides {
  return {
    ...overrides,
    [conflictId]: keybindingOverrideWithoutConflict(
      conflictId,
      binding,
      overrides,
      isMacOS,
    ),
  };
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  overrides: {},
  replaceOverrides: (overrides) => set({ overrides }),
  load: (value) => set({ overrides: deserializeKeybindingOverrides(value) }),
  set: (id, binding, isMacOS) =>
    set((state) => ({
      overrides: assign(state.overrides, id, binding, isMacOS),
    })),
  replace: (id, binding, conflictId, isMacOS) =>
    set((state) => ({
      overrides: assign(
        removeConflict(state.overrides, binding, conflictId, isMacOS),
        id,
        binding,
        isMacOS,
      ),
    })),
  removeConflict: (binding, conflictId, isMacOS) =>
    set((state) => ({
      overrides: removeConflict(state.overrides, binding, conflictId, isMacOS),
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
