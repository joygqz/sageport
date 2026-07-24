import { create } from "zustand";

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
