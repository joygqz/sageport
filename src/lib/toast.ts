import { create } from "zustand";

export type ToastKind = "info" | "success" | "warning" | "error";

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

const timers = new Map<
  string,
  {
    timeoutId: ReturnType<typeof setTimeout>;
    remaining: number;
    startedAt: number;
  }
>();

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
    timer.remaining = Math.max(
      timer.remaining - (Date.now() - timer.startedAt),
      0,
    );
  },
  resume: (id) => {
    const timer = timers.get(id);
    if (!timer) return;
    scheduleDismiss(id, timer.remaining);
  },
}));

export const toast = {
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "info", title, description }),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "success", title, description }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "warning", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: "error", title, description }),
};

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string" ? err : "Unexpected error";
}

export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return null;
}
