import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { Task, TaskInput, TaskStep } from "@/types/models";

export const tasksKey = ["tasks"] as const;
export const taskRunsKey = ["tasks", "runs"] as const;

export function parseTaskSteps(task: Task): TaskStep[] {
  try {
    const parsed = JSON.parse(task.steps);
    return Array.isArray(parsed) ? (parsed as TaskStep[]) : [];
  } catch {
    return [];
  }
}

export function useTasks() {
  return useQuery({ queryKey: tasksKey, queryFn: ipc.tasks.list });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) => ipc.tasks.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskInput }) =>
      ipc.tasks.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.tasks.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  });
}

export function useTaskRuns(enabled: boolean) {
  return useQuery({
    queryKey: taskRunsKey,
    queryFn: () => ipc.tasks.runsList(),
    enabled,
    staleTime: 0,
  });
}

export function useDeleteTaskRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.tasks.runsDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskRunsKey }),
  });
}

export function useClearTaskRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.tasks.runsClear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskRunsKey }),
  });
}
