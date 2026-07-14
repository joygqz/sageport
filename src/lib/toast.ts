import { create } from "zustand";

import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  actions?: ToastAction[];
  persistent?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

export const TOAST_DURATION = 4500;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) })),
}));

export const toast = {
  info: (title: string, description?: string) => {
    useToastStore.getState().push({ kind: "info", title, description });
  },
  success: (title: string, description?: string) => {
    useToastStore.getState().push({ kind: "success", title, description });
  },
  warning: (title: string, description?: string) => {
    useToastStore.getState().push({ kind: "warning", title, description });
  },
  error: (title: string, description?: string) => {
    useToastStore.getState().push({ kind: "error", title, description });
  },
};

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string"
    ? err
    : translate(detectLocale(), "common.unexpectedError");
}

export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return null;
}
