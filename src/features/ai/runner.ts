import { detectLocale } from "@/i18n/config";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage } from "@/lib/toast";
import type { AiChatMessage, AiModelLimits, AiToolCall } from "@/types/models";
import { findPane, targetPaneId, useTabsStore } from "@/workbench/tabs";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
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

const CONTEXT_SHRINK_FACTOR = 0.6;
const MAX_CONTEXT_SHRINKS = 3;

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

async function waitForRetry(
  host: RunnerHost,
  sessionId: string,
  delayMs: number,
): Promise<boolean> {
  const deadline = Date.now() + delayMs;
  while (!stopped(host, sessionId)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return true;
    await wait(Math.min(remaining, 50));
  }
  return false;
}

async function resolveLimitsForRun(
  host: RunnerHost,
  sessionId: string,
  model: string,
): Promise<AiModelLimits | null> {
  const pending = resolveModelLimits(model).then((value) => ({
    done: true as const,
    value,
  }));
  while (!stopped(host, sessionId)) {
    const result = await Promise.race([
      pending,
      wait(50).then(() => ({ done: false as const })),
    ]);
    if (result.done) return result.value;
  }
  return null;
}

function buildContext(
  omittedHistoryMessages: number,
  autoApprove: boolean,
  summary = "",
): string {
  const state = useTabsStore.getState();
  const current = findPane(state.tabs, targetPaneId(state));
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
      ? "Assistant mode: autonomous. Approved operation tools run automatically, except operations targeting a host marked as requiring manual approval; keep the user informed and ask before an action only when the requested scope is genuinely ambiguous."
      : "Assistant mode: supervised. Operation tools require the user's approval before they run.",
  ];
  if (omittedHistoryMessages > 0) {
    lines.push(
      `${omittedHistoryMessages} older chat messages are outside the model window; ask for missing details only if essential.`,
    );
  }
  if (summary) {
    lines.push(
      `Summary of the earlier conversation (older raw messages are outside the window):\n${summary}`,
    );
  }
  return lines.join("\n");
}

function historyBudgetFor(run: RunConfig, summary: string): number {
  const nonHistoryTokens =
    run.toolSpecTokens +
    estimateTextTokens(buildContext(0, run.autoApprove, summary)) +
    SYSTEM_PROMPT_ALLOWANCE_TOKENS;
  return Math.max(
    0,
    run.budget - Math.max(0, nonHistoryTokens - PROMPT_RESERVE_TOKENS),
  );
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
  let networkAttempt = 0;
  let contextShrinks = 0;
  let historyScale = 1;
  for (;;) {
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
      const summary = runtime.summary;
      const historyBudget = Math.floor(
        historyBudgetFor(run, summary) * historyScale,
      );
      const modelHistory = modelHistoryWindow(runtime.history, historyBudget);
      const result = await ipc.ai.chat(
        run.model,
        redactSensitiveHistory(modelHistory.messages),
        run.tools,
        {
          context: buildContext(
            modelHistory.omittedMessages,
            run.autoApprove,
            summary,
          ),
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
      const code = errorCode(err);
      if (code === "cancelled") {
        salvagePartial(host, sessionId, streamItemId);
        return null;
      }
      const canShrink =
        code === "context_length" && contextShrinks < MAX_CONTEXT_SHRINKS;
      const canRetryNetwork =
        code === "network" && networkAttempt < RETRY_DELAYS_MS.length;
      if ((!canShrink && !canRetryNetwork) || stopped(host, sessionId)) {
        salvagePartial(host, sessionId, streamItemId);
        throw err;
      }
      host.patch(sessionId, (r) => ({
        ...r,
        log: r.log.filter((i) => i.id !== streamItemId),
      }));
      if (canShrink) {
        contextShrinks += 1;
        historyScale *= CONTEXT_SHRINK_FACTOR;
      } else {
        const retry = await waitForRetry(
          host,
          sessionId,
          RETRY_DELAYS_MS[networkAttempt],
        );
        networkAttempt += 1;
        if (!retry) return null;
      }
      if (stopped(host, sessionId)) return null;
    }
  }
}

async function targetsApprovalHost(
  toolName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const ids = new Set<string>();
  const collectIds = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 4) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "hostId" && typeof nested === "string") ids.add(nested);
      if (key === "hostIds" && Array.isArray(nested)) {
        for (const id of nested) if (typeof id === "string") ids.add(id);
      } else {
        collectIds(nested, depth + 1);
      }
    }
  };
  collectIds(args);

  if (
    ["update_host", "delete_host", "move_host"].includes(toolName) &&
    typeof args.id === "string"
  ) {
    ids.add(args.id);
  }
  if (["run_terminal_command", "run_snippet"].includes(toolName)) {
    const tabs = useTabsStore.getState();
    const sessionId =
      typeof args.sessionId === "string" ? args.sessionId : targetPaneId(tabs);
    const pane = findPane(tabs.tabs, sessionId);
    if (pane?.hostId) ids.add(pane.hostId);
  }
  const indirectLookupTools = new Set([
    "update_identity",
    "delete_identity",
    "update_ssh_key",
    "delete_ssh_key",
    "update_forward",
    "start_forward",
    "stop_forward",
    "delete_forward",
    "delete_bookmark",
    "delete_group",
  ]);
  if (ids.size === 0 && !indirectLookupTools.has(toolName)) return false;
  try {
    const hosts = await ipc.hosts.list();
    if (
      ["update_identity", "delete_identity"].includes(toolName) &&
      typeof args.id === "string"
    ) {
      for (const host of hosts) {
        if (host.identityId === args.id) ids.add(host.id);
      }
    }
    if (
      ["update_ssh_key", "delete_ssh_key"].includes(toolName) &&
      typeof args.id === "string"
    ) {
      for (const host of hosts) if (host.keyId === args.id) ids.add(host.id);
      const identityIds = new Set(
        (await ipc.identities.list())
          .filter((identity) => identity.keyId === args.id)
          .map((identity) => identity.id),
      );
      for (const host of hosts) {
        if (host.identityId && identityIds.has(host.identityId))
          ids.add(host.id);
      }
    }
    if (
      [
        "update_forward",
        "start_forward",
        "stop_forward",
        "delete_forward",
      ].includes(toolName) &&
      typeof args.id === "string"
    ) {
      const forward = (await ipc.forwards.list()).find(
        (item) => item.id === args.id,
      );
      if (forward) ids.add(forward.hostId);
    }
    if (toolName === "delete_bookmark" && typeof args.id === "string") {
      const bookmark = (await ipc.bookmarks.list()).find(
        (item) => item.id === args.id,
      );
      if (bookmark?.hostId) ids.add(bookmark.hostId);
    }
    if (toolName === "delete_group" && typeof args.id === "string") {
      const groups = await ipc.groups.list();
      const groupIds = new Set([args.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const group of groups) {
          if (
            group.parentId &&
            groupIds.has(group.parentId) &&
            !groupIds.has(group.id)
          ) {
            groupIds.add(group.id);
            changed = true;
          }
        }
      }
      for (const host of hosts) {
        if (host.groupId && groupIds.has(host.groupId)) ids.add(host.id);
      }
    }
    if (ids.size === 0) return false;
    return hosts.some(
      (savedHost) => ids.has(savedHost.id) && savedHost.requiresApproval,
    );
  } catch {
    // Autonomous mode must fail closed when protection cannot be verified.
    return true;
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
  const approvalTarget =
    needsApproval &&
    autoApprove &&
    (await targetsApprovalHost(call.name, args));
  const waitForApproval = needsApproval && (!autoApprove || approvalTarget);
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
      } else if (!askUserOptions(args).includes(option)) {
        resultText =
          "Error: the selected answer is not one of the offered options.";
        resultIsError = true;
        setToolStatus("error", resultText);
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

const SUMMARY_MAX_OUTPUT_TOKENS = 1_024;
const SUMMARY_MESSAGE_CLIP_CHARS = 2_000;
const SUMMARY_ARGS_CLIP_CHARS = 400;

const SUMMARY_INSTRUCTIONS =
  "You are compacting an ongoing operations chat so it fits the model context window. " +
  "Rewrite the earlier conversation into a dense factual summary that preserves the user's " +
  "goals and constraints, the hosts/targets and connection state, decisions made and actions " +
  "taken, notable command results and the current system state, and any unresolved follow-ups. " +
  "Merge it with any existing summary. Do not invent details. Output only the summary text.";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function renderTranscript(messages: AiChatMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      lines.push(
        `User: ${clip(message.content ?? "", SUMMARY_MESSAGE_CLIP_CHARS)}`,
      );
    } else if (message.role === "assistant") {
      if (message.content) {
        lines.push(
          `Assistant: ${clip(message.content, SUMMARY_MESSAGE_CLIP_CHARS)}`,
        );
      }
      for (const call of message.toolCalls ?? []) {
        lines.push(
          `Assistant called ${call.name}(${clip(
            JSON.stringify(call.arguments),
            SUMMARY_ARGS_CLIP_CHARS,
          )})`,
        );
      }
    } else if (message.role === "tool") {
      lines.push(
        `Tool result: ${clip(message.content ?? "", SUMMARY_MESSAGE_CLIP_CHARS)}`,
      );
    }
  }
  return lines.join("\n");
}

async function ensureSummary(
  host: RunnerHost,
  sessionId: string,
  run: RunConfig,
): Promise<void> {
  const runtime = host.runtime(sessionId);
  if (!runtime || stopped(host, sessionId)) return;

  const budget = historyBudgetFor(run, runtime.summary);
  const window = modelHistoryWindow(runtime.history, budget);
  if (window.omittedMessages <= runtime.summaryUpTo) return;

  const upTo = window.omittedMessages;
  const slice = redactSensitiveHistory(
    runtime.history.slice(runtime.summaryUpTo, upTo),
  );
  const priorSummary = runtime.summary;
  const prompt =
    `${SUMMARY_INSTRUCTIONS}\n\n` +
    (priorSummary ? `Existing summary:\n${priorSummary}\n\n` : "") +
    `Conversation excerpt to fold into the summary:\n${renderTranscript(slice)}`;

  const requestId = crypto.randomUUID();
  host.patch(sessionId, (r) => ({ ...r, requestId, activity: "thinking" }));
  try {
    const result = await ipc.ai.chat(
      run.model,
      [{ role: "user", content: prompt }],
      [],
      { maxTokens: SUMMARY_MAX_OUTPUT_TOKENS, requestId },
    );
    const summary = result.content?.trim();
    clearRequestId(host, sessionId, requestId);
    if (summary && !stopped(host, sessionId)) {
      host.patch(sessionId, (r) => ({ ...r, summary, summaryUpTo: upTo }));
    }
  } catch {
    clearRequestId(host, sessionId, requestId);
  }
}

export async function runAgentLoop(
  host: RunnerHost,
  sessionId: string,
  model: string,
  autoApprove = false,
  enabledToolNames: readonly string[] = [],
  maxHistoryTokens?: number | null,
): Promise<void> {
  const limits = await resolveLimitsForRun(host, sessionId, model);
  if (stopped(host, sessionId)) return;
  const tools = enabledToolSpecs(enabledToolNames);
  const run: RunConfig = {
    model,
    budget: historyTokenBudget(limits, maxHistoryTokens),
    maxTokens: outputTokenBudget(limits),
    autoApprove,
    tools,
    toolNames: new Set(tools.map((tool) => tool.name)),
    toolSpecTokens: estimateTextTokens(JSON.stringify(tools)),
  };
  const contextWindow =
    limits?.contextWindow && limits.contextWindow > 0
      ? limits.contextWindow
      : DEFAULT_CONTEXT_WINDOW_TOKENS;
  host.patch(sessionId, (r) => ({ ...r, contextWindow }));

  for (let step = 0; step < MAX_STEPS; step++) {
    await ensureSummary(host, sessionId, run);
    if (stopped(host, sessionId)) return;
    const streamItemId = crypto.randomUUID();
    const result = await requestStep(host, sessionId, run, streamItemId);
    if (!result) return;
    if (result.usage) {
      const inputTokens = result.usage.inputTokens;
      host.patch(sessionId, (r) => ({ ...r, contextTokens: inputTokens }));
    }

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
  host.patch(sessionId, (r) => ({ ...r, stepLimitReached: true }));
  await host.persist(sessionId);
}
