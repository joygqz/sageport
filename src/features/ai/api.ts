import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { AiConfig, AiProtocol } from "@/types/models";
import { clearModelLimitsCache } from "./model-limits";

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

function effectiveBaseUrl(baseUrl: string, protocol: AiProtocol): string {
  return (baseUrl.trim() || defaultBaseUrl(protocol)).replace(/\/+$/, "");
}

export function useAiConfig() {
  return useQuery({ queryKey: configKey, queryFn: ipc.ai.getConfig });
}

export function useSetAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: "ai-settings" },
    mutationFn: ipc.ai.setConfig,
    onSuccess: (_, input) => {
      clearModelLimitsCache();
      qc.setQueryData<AiConfig>(configKey, (prev) =>
        prev
          ? {
              ...input,
              model:
                prev.protocol === input.protocol &&
                effectiveBaseUrl(prev.baseUrl, prev.protocol) ===
                  effectiveBaseUrl(input.baseUrl, input.protocol)
                  ? prev.model
                  : "",
            }
          : prev,
      );
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
    scope: { id: "ai-settings" },
    mutationFn: (model: string) => ipc.ai.setModel(model),
    onMutate: async (model) => {
      await qc.cancelQueries({ queryKey: configKey });
      const previous = qc.getQueryData<AiConfig>(configKey);
      qc.setQueryData<AiConfig>(configKey, (current) =>
        current ? { ...current, model } : current,
      );
      return { previous };
    },
    onError: (_error, _model, context) => {
      if (context?.previous) qc.setQueryData(configKey, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: configKey }),
  });
}
