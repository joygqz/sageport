import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage } from "@/lib/toast";
import type { AiToolCall } from "@/types/models";
import { targetTerminalId, terminalTabs, useTabsStore } from "@/workbench/tabs";
import {
  estimateTextTokens,
  historyTokenBudget,
  modelHistoryWindow,
  outputTokenBudget,
  PROMPT_RESERVE_TOKENS,
} from "./history";
import { resolveModelLimits } from "./model-limits";
import {
  askUserOptions,
  askUserQuestion,
  enabledToolSpecs,
  executeTool,
  normalizeArgs,
  prepareTool,
  selectionResult,
  TOOLS_REQUIRING_APPROVAL,
  validateToolArguments,
} from "./tools";
import {
  DECLINED_RESULT,
  STOPPED_RESULT,
  redactSensitiveHistory,
  truncateToolResult,
  type RuntimeSession,
  type ToolStatus,
} from "./transcript";

const MAX_STEPS = 24;

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

const SYSTEM_PROMPT_ALLOWANCE_TOKENS = 1_000;

export interface RunnerHost {
  runtime: (sessionId: string) => RuntimeSession | undefined;
  patch: (sessionId: string, fn: (r: RuntimeSession) => RuntimeSession) => void;
  persist: (sessionId: string) => Promise<void>;
  requestApproval: (sessionId: string, toolLogId: string) => Promise<boolean>;
  requestAnswer: (
    sessionId: string,
    toolLogId: string,
  ) => Promise<string | null>;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildContext(
  omittedHistoryMessages: number,
  autoApprove: boolean,
): string {
  const state = useTabsStore.getState();
  const sessions = terminalTabs(state.tabs);
  const currentId = targetTerminalId(state);
  const current = sessions.find((session) => session.id === currentId);
  const lines = [
    `App: Sageport v${__APP_VERSION__}, a desktop SSH client.`,
    `UI language: ${detectLocale()}.`,
    current
      ? `Current terminal (default target): ${JSON.stringify({
          id: current.id,
          host: current.title,
          hostId: current.hostId || undefined,
          target: current.target,
          address: current.adhoc?.host,
          status: current.status,
        })}`
      : "Current terminal: none.",
    autoApprove
      ? "Assistant mode: autonomous. Approved operation tools run automatically; keep the user informed and ask before an action only when the requested scope is genuinely ambiguous."
      : "Assistant mode: supervised. Operation tools require the user's approval before they run.",
  ];
  if (omittedHistoryMessages > 0) {
    lines.push(
      `${omittedHistoryMessages} older chat messages are outside the model window; ask for missing details only if essential.`,
    );
  }
  return lines.join("\n");
}

type PreparedToolCall = {
  call: AiToolCall;
  preflightError?: string;
  automaticResult?: string;
};

async function prepareToolCall(
  call: AiToolCall,
  userPrompt: string,
  availableToolNames: ReadonlySet<string>,
): Promise<PreparedToolCall> {
  const args = normalizeArgs(call.arguments);
  if (!availableToolNames.has(call.name)) {
    return {
      call: { ...call, arguments: args },
      preflightError: `Error: tool "${call.name}" is disabled in AI settings.`,
    };
  }
  const validationError = validateToolArguments(call.name, args);
  if (validationError) {
    return {
      call: { ...call, arguments: args },
      preflightError: validationError,
    };
  }
  try {
    const prepared = await prepareTool(call.name, args, { userPrompt });
    return {
      call: { ...call, arguments: prepared.args },
      preflightError: prepared.preflightError,
      automaticResult: prepared.automaticResult,
    };
  } catch (err) {
    return {
      call: { ...call, arguments: args },
      preflightError: `Error: ${call.name} preflight failed: ${errorMessage(err)}`,
    };
  }
}

function uniqueToolCalls(
  calls: AiToolCall[],
  existing: Iterable<string> = [],
): AiToolCall[] {
  const seen = new Set(existing);
  return calls.map((call) => {
    if (!seen.has(call.id)) {
      seen.add(call.id);
      return call;
    }
    const id = `${call.id}-${crypto.randomUUID()}`;
    seen.add(id);
    return { ...call, id };
  });
}

function stopped(host: RunnerHost, sessionId: string): boolean {
  return host.runtime(sessionId)?.stopRequested ?? false;
}

function salvagePartial(
  host: RunnerHost,
  sessionId: string,
  streamItemId: string,
): void {
  const partial = host
    .runtime(sessionId)
    ?.log.find((i) => i.id === streamItemId);
  if (partial?.kind === "assistant" && partial.content) {
    host.patch(sessionId, (r) => ({
      ...r,
      history: [...r.history, { role: "assistant", content: partial.content }],
    }));
  }
}

function appendDelta(
  host: RunnerHost,
  sessionId: string,
  itemId: string,
  text: string,
): void {
  host.patch(sessionId, (r) => {
    const existing = r.log.find((i) => i.id === itemId);
    if (!existing) {
      return {
        ...r,
        activity: "responding",
        log: [...r.log, { id: itemId, kind: "assistant", content: text }],
      };
    }
    return {
      ...r,
      activity: "responding",
      log: r.log.map((i) =>
        i.id === itemId && i.kind === "assistant"
          ? { ...i, content: i.content + text }
          : i,
      ),
    };
  });
}

function clearRequestId(
  host: RunnerHost,
  sessionId: string,
  requestId: string,
): void {
  host.patch(sessionId, (r) =>
    r.requestId === requestId ? { ...r, requestId: null } : r,
  );
}

type RunConfig = {
  model: string;
  budget: number;
  maxTokens: number;
  autoApprove: boolean;
  tools: ReturnType<typeof enabledToolSpecs>;
  toolNames: ReadonlySet<string>;
  toolSpecTokens: number;
};

async function requestStep(
  host: RunnerHost,
  sessionId: string,
  run: RunConfig,
  streamItemId: string,
) {
  for (let attempt = 0; ; attempt++) {
    const runtime = host.runtime(sessionId);
    if (!runtime) return null;

    const requestId = crypto.randomUUID();
    host.patch(sessionId, (r) => ({
      ...r,
      requestId,
      activity: "thinking",
    }));

    let turnDone = false;
    try {
      const contextWithoutOmissions = buildContext(0, run.autoApprove);
      const nonHistoryTokens =
        run.toolSpecTokens +
        estimateTextTokens(contextWithoutOmissions) +
        SYSTEM_PROMPT_ALLOWANCE_TOKENS;
      const historyBudget = Math.max(
        0,
        run.budget - Math.max(0, nonHistoryTokens - PROMPT_RESERVE_TOKENS),
      );
      const modelHistory = modelHistoryWindow(
        redactSensitiveHistory(runtime.history),
        historyBudget,
      );
      const result = await ipc.ai.chat(
        run.model,
        modelHistory.messages,
        run.tools,
        {
          context: buildContext(modelHistory.omittedMessages, run.autoApprove),
          maxTokens: run.maxTokens,
          requestId,
          onDelta: (text) => {
            if (!turnDone && !stopped(host, sessionId)) {
              appendDelta(host, sessionId, streamItemId, text);
            }
          },
        },
      );
      turnDone = true;
      clearRequestId(host, sessionId, requestId);
      if (stopped(host, sessionId)) {
        salvagePartial(host, sessionId, streamItemId);
        return null;
      }
      return result;
    } catch (err) {
      turnDone = true;
      clearRequestId(host, sessionId, requestId);
      if (errorCode(err) === "cancelled") {
        salvagePartial(host, sessionId, streamItemId);
        return null;
      }
      if (
        errorCode(err) !== "network" ||
        attempt >= RETRY_DELAYS_MS.length ||
        stopped(host, sessionId)
      ) {
        salvagePartial(host, sessionId, streamItemId);
        throw err;
      }
      host.patch(sessionId, (r) => ({
        ...r,
        log: r.log.filter((i) => i.id !== streamItemId),
      }));
      await wait(RETRY_DELAYS_MS[attempt]);
      if (stopped(host, sessionId)) return null;
    }
  }
}

async function runToolCall(
  host: RunnerHost,
  sessionId: string,
  call: AiToolCall,
  autoApprove: boolean,
  preflightError?: string,
  automaticResult?: string,
): Promise<void> {
  if (automaticResult) {
    host.patch(sessionId, (r) => ({
      ...r,
      history: [
        ...r.history,
        {
          role: "tool",
          toolCallId: call.id,
          content: automaticResult,
          toolError: false,
        },
      ],
    }));
    return;
  }
  const args = normalizeArgs(call.arguments);
  const logId = crypto.randomUUID();
  const needsApproval = TOOLS_REQUIRING_APPROVAL.has(call.name);
  const waitForApproval = needsApproval && !autoApprove;
  const isQuestion =
    call.name === "ask_user" &&
    Boolean(askUserQuestion(args)) &&
    askUserOptions(args).length >= 2;
  const initialStatus: ToolStatus = preflightError
    ? "error"
    : isQuestion
      ? "awaiting-input"
      : waitForApproval
        ? "awaiting-approval"
        : "running";

  host.patch(sessionId, (r) => ({
    ...r,
    log: [
      ...r.log,
      {
        id: logId,
        kind: "tool",
        toolCallId: call.id,
        name: call.name,
        args,
        status: initialStatus,
        result: preflightError,
      },
    ],
  }));

  const setToolStatus = (status: ToolStatus, result?: string) =>
    host.patch(sessionId, (r) => ({
      ...r,
      log: r.log.map((item) =>
        item.kind === "tool" && item.id === logId
          ? { ...item, status, result: result ?? item.result }
          : item,
      ),
    }));

  let resultText: string;
  let resultIsError = false;
  if (preflightError) {
    resultText = preflightError;
    resultIsError = true;
  } else if (call.name === "ask_user") {
    if (!isQuestion) {
      resultText =
        "Error: ask_user needs a question and 2-6 non-empty string options.";
      resultIsError = true;
      setToolStatus("error", resultText);
    } else {
      const option = await host.requestAnswer(sessionId, logId);
      if (option === null) {
        resultText = STOPPED_RESULT;
        setToolStatus("denied", resultText);
      } else {
        resultText = selectionResult(option);
        setToolStatus("done", resultText);
      }
    }
  } else if (
    waitForApproval &&
    !(await host.requestApproval(sessionId, logId))
  ) {
    resultText = DECLINED_RESULT;
    setToolStatus("denied", resultText);
  } else {
    if (waitForApproval) setToolStatus("running");
    try {
      const result = await executeTool(call.name, args, {
        isCancelled: () => stopped(host, sessionId),
      });
      resultText = truncateToolResult(result.content);
      resultIsError = result.isError;
      setToolStatus(result.isError ? "error" : "done", resultText);
    } catch (err) {
      resultText = `Error: ${errorMessage(err)}`;
      resultIsError = true;
      setToolStatus("error", resultText);
    }
  }

  host.patch(sessionId, (r) => ({
    ...r,
    history: [
      ...r.history,
      {
        role: "tool",
        toolCallId: call.id,
        content: resultText,
        toolError: resultIsError,
      },
    ],
  }));
}

export async function runAgentLoop(
  host: RunnerHost,
  sessionId: string,
  model: string,
  autoApprove = false,
  enabledToolNames: readonly string[] = [],
): Promise<void> {
  const limits = await resolveModelLimits(model);
  const tools = enabledToolSpecs(enabledToolNames);
  const run: RunConfig = {
    model,
    budget: historyTokenBudget(limits),
    maxTokens: outputTokenBudget(limits),
    autoApprove,
    tools,
    toolNames: new Set(tools.map((tool) => tool.name)),
    toolSpecTokens: estimateTextTokens(JSON.stringify(tools)),
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const streamItemId = crypto.randomUUID();
    const result = await requestStep(host, sessionId, run, streamItemId);
    if (!result) return;

    const history = host.runtime(sessionId)?.history ?? [];
    const userPrompt =
      [...history].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    const preparedToolCalls = await Promise.all(
      uniqueToolCalls(
        result.toolCalls ?? [],
        history.flatMap((message) =>
          (message.toolCalls ?? []).map((call) => call.id),
        ),
      ).map((call) => prepareToolCall(call, userPrompt, run.toolNames)),
    );
    const toolCalls = preparedToolCalls.map((x) => x.call);
    host.patch(sessionId, (r) => ({
      ...r,
      activity: null,
      history: [
        ...r.history,
        {
          role: "assistant",
          content: result.content,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        },
      ],

      log: result.content
        ? r.log.some((i) => i.id === streamItemId)
          ? r.log.map((i) =>
              i.id === streamItemId && i.kind === "assistant"
                ? { ...i, content: result.content! }
                : i,
            )
          : [
              ...r.log,
              {
                id: streamItemId,
                kind: "assistant",
                content: result.content,
              },
            ]
        : r.log.filter((i) => i.id !== streamItemId),
    }));
    await host.persist(sessionId);

    if (toolCalls.length === 0) return;
    for (const { call, preflightError, automaticResult } of preparedToolCalls) {
      if (stopped(host, sessionId)) {
        host.patch(sessionId, (r) => ({
          ...r,
          history: [
            ...r.history,
            {
              role: "tool",
              toolCallId: call.id,
              content: STOPPED_RESULT,
              toolError: false,
            },
          ],
        }));
        continue;
      }
      await runToolCall(
        host,
        sessionId,
        call,
        run.autoApprove,
        preflightError,
        automaticResult,
      );
    }
    await host.persist(sessionId);
    if (stopped(host, sessionId)) return;
  }
  const limitMessage = translate(detectLocale(), "ai.stepLimitReached");
  host.patch(sessionId, (r) => ({
    ...r,
    history: [...r.history, { role: "assistant", content: limitMessage }],
    log: [
      ...r.log,
      {
        id: crypto.randomUUID(),
        kind: "assistant",
        content: limitMessage,
      },
    ],
  }));
  await host.persist(sessionId);
}
