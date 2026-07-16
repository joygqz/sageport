import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { AiConfig, AiProtocol } from "@/types/models";
import { clearModelLimitsCache } from "./model-limits";

const configKey = ["ai", "config"] as const;
const modelsKey = ["ai", "models"] as const;

export const AI_PROTOCOLS: { value: AiProtocol; exampleBaseUrl: string }[] = [
  { value: "openai", exampleBaseUrl: "https://api.openai.com/v1" },
  { value: "anthropic", exampleBaseUrl: "https://api.anthropic.com" },
];

export function exampleBaseUrl(protocol: AiProtocol): string {
  return (
    AI_PROTOCOLS.find((p) => p.value === protocol)?.exampleBaseUrl ??
    AI_PROTOCOLS[0].exampleBaseUrl
  );
}

function effectiveBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
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
      const prev = qc.getQueryData<AiConfig>(configKey);
      const endpointChanged =
        !prev ||
        prev.protocol !== input.protocol ||
        effectiveBaseUrl(prev.baseUrl) !== effectiveBaseUrl(input.baseUrl);
      if (prev) {
        qc.setQueryData<AiConfig>(configKey, {
          ...prev,
          baseUrl: input.baseUrl,
          protocol: input.protocol,
          autoApprove: input.autoApprove,
          enabledTools: input.enabledTools,
          maxHistoryTokens: input.maxHistoryTokens,
          hasApiKey:
            input.apiKey === undefined
              ? prev.hasApiKey
              : Boolean(input.apiKey.trim()),
          model: endpointChanged ? "" : prev.model,
        });
      }
      if (endpointChanged || !prev || input.apiKey !== undefined) {
        qc.removeQueries({ queryKey: modelsKey });
      }
      qc.invalidateQueries({ queryKey: configKey });
    },
  });
}

export function useAiModels(enabled: boolean) {
  const { data: config } = useAiConfig();
  return useQuery({
    queryKey: modelsKey,
    queryFn: ipc.ai.listModels,
    enabled: enabled && Boolean(config?.baseUrl.trim()),
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
