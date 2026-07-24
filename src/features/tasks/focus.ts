import { create } from "zustand";

/**
 * A cross-component request to reveal a specific task in the Tasks view, set from
 * outside the view (currently the tray menu). `TasksView` watches `taskId`, opens
 * that task, and clears it. Kept tiny and separate so the trigger and the view
 * stay decoupled.
 */
interface TaskFocusState {
  taskId: string | null;
  focus: (taskId: string) => void;
  clear: () => void;
}

export const useTaskFocusStore = create<TaskFocusState>((set) => ({
  taskId: null,
  focus: (taskId) => set({ taskId }),
  clear: () => set({ taskId: null }),
}));
