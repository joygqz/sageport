import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { AiProtocol } from "@/types/models";

const configKey = ["ai", "config"] as const;
const modelsKey = ["ai", "models"] as const;

export const AI_PROTOCOLS: { value: AiProtocol; defaultBaseUrl: string }[] = [
  { value: "openai", defaultBaseUrl: "https://api.openai.com/v1" },
  { value: "anthropic", defaultBaseUrl: "https://api.anthropic.com" },
];

export function defaultBaseUrl(protocol: AiProtocol): string {
  return (
    AI_PROTOCOLS.find((p) => p.value === protocol)?.defaultBaseUrl ??
    AI_PROTOCOLS[0].defaultBaseUrl
  );
}

export function useAiConfig() {
  return useQuery({ queryKey: configKey, queryFn: ipc.ai.getConfig });
}

export function useSetAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ipc.ai.setConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: configKey });
      qc.invalidateQueries({ queryKey: modelsKey });
    },
  });
}

export function useAiModels(enabled: boolean) {
  return useQuery({
    queryKey: modelsKey,
    queryFn: ipc.ai.listModels,
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useSetAiModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => ipc.ai.setModel(model),
    onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
  });
}
