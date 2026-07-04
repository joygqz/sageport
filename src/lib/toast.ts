import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
  pause: (id: string) => void;
  resume: (id: string) => void;
}

const DURATION = 4500;

/** Auto-dismiss timers, kept outside store state since they aren't serializable. */
const timers = new Map<string, { timeoutId: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>();

function scheduleDismiss(id: string, ms: number) {
  const timeoutId = setTimeout(() => {
    timers.delete(id);
    useToastStore.getState().dismiss(id);
  }, ms);
  timers.set(id, { timeoutId, remaining: ms, startedAt: Date.now() });
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    scheduleDismiss(id, DURATION);
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer.timeoutId);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  pause: (id) => {
    const timer = timers.get(id);
    if (!timer) return;
    clearTimeout(timer.timeoutId);
    timer.remaining = Math.max(timer.remaining - (Date.now() - timer.startedAt), 0);
  },
  resume: (id) => {
    const timer = timers.get(id);
    if (!timer) return;
    scheduleDismiss(id, timer.remaining);
  },
}));

/** Imperative helper usable outside React (e.g. in mutation callbacks). */
export const toast = {
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "info", title, description }),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "error", title, description }),
};

/** Normalize a thrown command error into a readable string. */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string" ? err : "Unexpected error";
}

/**
 * Machine-readable error code set by the backend (`AppError::code`), e.g.
 * "in_use" | "not_found" | "invalid". Lets callers show a localized,
 * human-friendly description instead of the raw English message.
 */
export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return null;
}
