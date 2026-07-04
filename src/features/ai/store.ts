import { create } from "zustand";

import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type {
  AiChatMessage,
  AiSessionSummary,
  AiToolCall,
} from "@/types/models";
import { targetTerminalId, terminalTabs, useTabsStore } from "@/workbench/tabs";
import {
  AI_TOOL_SPECS,
  executeTool,
  noTerminalSessionError,
  normalizeArgs,
  resolveTerminalSessionId,
  TOOLS_REQUIRING_APPROVAL,
} from "./tools";

/** Hard cap on model round-trips per user message, to bound a runaway loop. */
const MAX_STEPS = 8;
/** How much of the first prompt to use as an auto-generated session title. */
const TITLE_MAX_LEN = 60;

/** Imperative translation helper — this store lives outside React. */
function t(key: Parameters<typeof translate>[1]): string {
  return translate(detectLocale(), key);
}

export type ToolStatus =
  "awaiting-approval" | "running" | "done" | "denied" | "error";

export type AgentLogItem =
  | { id: string; kind: "user"; content: string }
  | { id: string; kind: "assistant"; content: string }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      name: string;
      args: Record<string, unknown>;
      status: ToolStatus;
      result?: string;
    };

/** In-memory state for one chat session, keyed by session id. */
interface RuntimeSession {
  /** Canonical conversation sent to `ai_chat` / persisted to disk. */
  history: AiChatMessage[];
  /** Rendered log (richer than `history`: tool status, args, bubbles). */
  log: AgentLogItem[];
  pending: boolean;
  /** Backend id of the in-flight chat turn, for mid-stream cancellation. */
  requestId: string | null;
  /** Set by `stop`; the agent loop winds down at the next safe point. */
  stopRequested: boolean;
}

interface AiStoreState {
  /** Newest-first, backed by the `ai_sessions` table. */
  sessions: AiSessionSummary[];
  sessionsLoaded: boolean;
  activeId: string | null;
  runtime: Record<string, RuntimeSession>;
  approvals: Map<string, (approved: boolean) => void>;

  /** Load the session list once, on first mount of the panel. */
  loadSessions: () => Promise<void>;
  /** Make a session active, hydrating its conversation from disk if needed. */
  openSession: (id: string) => Promise<void>;
  /** Create a brand new, empty session and make it active. */
  newSession: () => Promise<string>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;

  send: (sessionId: string, prompt: string, model: string) => Promise<void>;
  /** Abort the running turn: cancels the request and stops the agent loop. */
  stop: (sessionId: string) => void;
  approve: (toolLogId: string) => void;
  deny: (toolLogId: string) => void;
}

/**
 * Workspace snapshot appended to the system prompt on every turn, so the
 * model knows what it is working with before calling any tool: which
 * sessions are open, which one the user is looking at, and the UI language.
 */
function buildContext(): string {
  const state = useTabsStore.getState();
  const sessions = terminalTabs(state.tabs);
  const focusedId = targetTerminalId(state);
  const lines = [
    `App: Sageport v${__APP_VERSION__}, a desktop SSH client.`,
    `UI language: ${detectLocale()}.`,
    sessions.length === 0
      ? "No terminal sessions are open."
      : `Open terminal sessions: ${JSON.stringify(
          sessions.map((s) => ({
            id: s.id,
            host: s.title,
            status: s.status,
            focused: s.id === focusedId,
          })),
        )}`,
  ];
  return lines.join("\n");
}

/** Reconstruct a renderable log from a persisted canonical history. */
function buildLogFromHistory(messages: AiChatMessage[]): AgentLogItem[] {
  const log: AgentLogItem[] = [];
  const toolItemByCallId = new Map<
    string,
    Extract<AgentLogItem, { kind: "tool" }>
  >();

  for (const m of messages) {
    if (m.role === "user") {
      log.push({
        id: crypto.randomUUID(),
        kind: "user",
        content: m.content ?? "",
      });
    } else if (m.role === "assistant") {
      if (m.content) {
        log.push({
          id: crypto.randomUUID(),
          kind: "assistant",
          content: m.content,
        });
      }
      for (const call of m.toolCalls ?? []) {
        const item: Extract<AgentLogItem, { kind: "tool" }> = {
          id: crypto.randomUUID(),
          kind: "tool",
          toolCallId: call.id,
          name: call.name,
          args: normalizeArgs(call.arguments),
          status: "done",
        };
        log.push(item);
        toolItemByCallId.set(call.id, item);
      }
    } else if (m.role === "tool" && m.toolCallId) {
      const item = toolItemByCallId.get(m.toolCallId);
      if (item) {
        item.result = m.content;
        if (m.content === "The user declined to run this command.") {
          item.status = "denied";
        } else if (m.content?.startsWith("Error:")) {
          item.status = "error";
        }
      }
    }
  }
  return log;
}

function deriveTitle(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0].trim();
  return firstLine.length > TITLE_MAX_LEN
    ? `${firstLine.slice(0, TITLE_MAX_LEN).trimEnd()}…`
    : firstLine;
}

type PreparedToolCall = {
  call: AiToolCall;
  preflightError?: string;
};

function prepareToolCall(call: AiToolCall): PreparedToolCall {
  if (call.name !== "run_terminal_command") return { call };

  const args = normalizeArgs(call.arguments);
  const requested =
    typeof args.sessionId === "string" ? args.sessionId : undefined;
  const sessionId = resolveTerminalSessionId(requested);

  if (!sessionId) {
    return {
      call: { ...call, arguments: args },
      preflightError: noTerminalSessionError(requested),
    };
  }

  // Approval is for a concrete terminal. If the user switches or closes tabs
  // before clicking Allow, the command will not silently retarget elsewhere.
  return { call: { ...call, arguments: { ...args, sessionId } } };
}

export const useAiStore = create<AiStoreState>((set, get) => {
  /** Immutably patch one session's runtime slice. */
  const patch = (id: string, fn: (r: RuntimeSession) => RuntimeSession) => {
    set((s) => {
      const current = s.runtime[id];
      if (!current) return s;
      return { runtime: { ...s.runtime, [id]: fn(current) } };
    });
  };

  /** Save the conversation to disk and fold the updated summary back in. */
  const persist = async (id: string, title: string | null) => {
    const history = get().runtime[id]?.history ?? [];
    try {
      const summary = await ipc.ai.session.save(id, history, title);
      set((s) => ({
        sessions: [summary, ...s.sessions.filter((x) => x.id !== id)],
      }));
    } catch {
      // Best-effort: the in-memory conversation still stands even if the
      // write failed (e.g. transient disk error); it'll retry next turn.
    }
  };

  const runToolCall = async (
    sessionId: string,
    call: AiToolCall,
    preflightError?: string,
  ) => {
    const args = normalizeArgs(call.arguments);
    const logId = crypto.randomUUID();
    const needsApproval = TOOLS_REQUIRING_APPROVAL.has(call.name);
    const initialStatus: ToolStatus = preflightError
      ? "error"
      : needsApproval
        ? "awaiting-approval"
        : "running";

    patch(sessionId, (r) => ({
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
      patch(sessionId, (r) => ({
        ...r,
        log: r.log.map((item) =>
          item.kind === "tool" && item.id === logId
            ? { ...item, status, result: result ?? item.result }
            : item,
        ),
      }));

    let resultText: string;
    if (preflightError) {
      resultText = preflightError;
    } else if (needsApproval && !(await requestApproval(get, logId))) {
      resultText = "The user declined to run this command.";
      setToolStatus("denied", resultText);
    } else {
      if (needsApproval) setToolStatus("running");
      try {
        resultText = await executeTool(call.name, args);
        setToolStatus("done", resultText);
      } catch (err) {
        resultText = `Error: ${errorMessage(err)}`;
        setToolStatus("error", resultText);
      }
    }

    patch(sessionId, (r) => ({
      ...r,
      history: [
        ...r.history,
        { role: "tool", toolCallId: call.id, content: resultText },
      ],
    }));
  };

  /** Append `text` to the streaming assistant bubble, creating it lazily. */
  const appendDelta = (sessionId: string, itemId: string, text: string) => {
    patch(sessionId, (r) => {
      const existing = r.log.find((i) => i.id === itemId);
      if (!existing) {
        return {
          ...r,
          log: [...r.log, { id: itemId, kind: "assistant", content: text }],
        };
      }
      return {
        ...r,
        log: r.log.map((i) =>
          i.id === itemId && i.kind === "assistant"
            ? { ...i, content: i.content + text }
            : i,
        ),
      };
    });
  };

  const stopped = (sessionId: string) =>
    get().runtime[sessionId]?.stopRequested ?? false;

  const runLoop = async (sessionId: string, model: string) => {
    for (let step = 0; step < MAX_STEPS; step++) {
      const runtime = get().runtime[sessionId];
      // Session was deleted out from under a still-running loop — stop
      // quietly rather than throwing on the missing runtime slice.
      if (!runtime) return;

      const requestId = crypto.randomUUID();
      const streamItemId = crypto.randomUUID();
      patch(sessionId, (r) => ({ ...r, requestId }));

      // Ignore any delta that straggles in after the turn has resolved —
      // the returned result is authoritative and already rendered by then.
      let turnDone = false;
      let result;
      try {
        result = await ipc.ai.chat(model, runtime.history, AI_TOOL_SPECS, {
          context: buildContext(),
          requestId,
          onDelta: (text) => {
            if (!turnDone) appendDelta(sessionId, streamItemId, text);
          },
        });
      } catch (err) {
        turnDone = true;
        if (errorCode(err) !== "cancelled") throw err;
        // Stopped mid-stream: keep whatever text already streamed, both on
        // screen and in the canonical history, then wind down quietly.
        const partial = get()
          .runtime[sessionId]?.log.find((i) => i.id === streamItemId);
        if (partial?.kind === "assistant" && partial.content) {
          patch(sessionId, (r) => ({
            ...r,
            history: [
              ...r.history,
              { role: "assistant", content: partial.content },
            ],
          }));
        }
        return;
      }

      turnDone = true;
      const preparedToolCalls = (result.toolCalls ?? []).map(prepareToolCall);
      const toolCalls = preparedToolCalls.map((x) => x.call);
      patch(sessionId, (r) => ({
        ...r,
        history: [
          ...r.history,
          {
            role: "assistant",
            content: result.content,
            toolCalls: toolCalls.length ? toolCalls : undefined,
          },
        ],
        // The final content is authoritative: replace the streamed bubble's
        // text with it (they only differ in whitespace normalization), or
        // add the bubble now if nothing streamed (e.g. tool-calls-only turn
        // from a provider that still sent text at once).
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

      if (toolCalls.length === 0) return;
      for (const { call, preflightError } of preparedToolCalls) {
        if (stopped(sessionId)) {
          // Keep the conversation protocol-valid: every requested call gets
          // a result, even when the user aborted the run.
          patch(sessionId, (r) => ({
            ...r,
            history: [
              ...r.history,
              {
                role: "tool",
                toolCallId: call.id,
                content: "The user stopped this run before the call executed.",
              },
            ],
          }));
          continue;
        }
        await runToolCall(sessionId, call, preflightError);
      }
      if (stopped(sessionId)) return;
    }
    patch(sessionId, (r) => ({
      ...r,
      log: [
        ...r.log,
        {
          id: crypto.randomUUID(),
          kind: "assistant",
          content: t("ai.stepLimitReached"),
        },
      ],
    }));
  };

  return {
    sessions: [],
    sessionsLoaded: false,
    activeId: null,
    runtime: {},
    approvals: new Map(),

    loadSessions: async () => {
      if (get().sessionsLoaded) return;
      const sessions = await ipc.ai.session.list();
      set({ sessions, sessionsLoaded: true });
      if (sessions.length > 0) {
        await get().openSession(sessions[0].id);
      }
    },

    openSession: async (id) => {
      set({ activeId: id });
      if (get().runtime[id]) return;
      const session = await ipc.ai.session.get(id);
      set((s) => ({
        runtime: {
          ...s.runtime,
          [id]: {
            history: session.messages,
            log: buildLogFromHistory(session.messages),
            pending: false,
            requestId: null,
            stopRequested: false,
          },
        },
      }));
    },

    newSession: async () => {
      const session = await ipc.ai.session.create();
      set((s) => ({
        sessions: [
          {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          },
          ...s.sessions,
        ],
        runtime: {
          ...s.runtime,
          [session.id]: {
            history: [],
            log: [],
            pending: false,
            requestId: null,
            stopRequested: false,
          },
        },
        activeId: session.id,
      }));
      return session.id;
    },

    renameSession: async (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const summary = await ipc.ai.session.rename(id, trimmed);
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === id ? summary : x)),
        }));
      } catch (err) {
        toast.error(t("ai.error"), errorMessage(err));
      }
    },

    deleteSession: async (id) => {
      try {
        await ipc.ai.session.remove(id);
      } catch (err) {
        toast.error(t("ai.error"), errorMessage(err));
        return;
      }
      set((s) => {
        const sessions = s.sessions.filter((x) => x.id !== id);
        const runtime = { ...s.runtime };
        delete runtime[id];
        const activeId = s.activeId === id ? null : s.activeId;
        return { sessions, runtime, activeId };
      });
    },

    send: async (sessionId, prompt, model) => {
      const trimmed = prompt.trim();
      const runtime = get().runtime[sessionId];
      if (!trimmed || !model || !runtime || runtime.pending) return;

      const isFirstTurn = runtime.history.length === 0;
      const title = isFirstTurn ? deriveTitle(trimmed) : null;

      patch(sessionId, (r) => ({
        ...r,
        pending: true,
        stopRequested: false,
        log: [
          ...r.log,
          { id: crypto.randomUUID(), kind: "user", content: trimmed },
        ],
        history: [...r.history, { role: "user", content: trimmed }],
      }));

      try {
        await runLoop(sessionId, model);
      } catch (err) {
        const message = errorMessage(err);
        toast.error(t("ai.error"), message);
        patch(sessionId, (r) => ({
          ...r,
          log: [
            ...r.log,
            {
              id: crypto.randomUUID(),
              kind: "assistant",
              content: `⚠️ ${message}`,
            },
          ],
        }));
      } finally {
        patch(sessionId, (r) => ({
          ...r,
          pending: false,
          requestId: null,
          stopRequested: false,
        }));
        void persist(sessionId, title);
      }
    },

    stop: (sessionId) => {
      const runtime = get().runtime[sessionId];
      if (!runtime?.pending) return;
      patch(sessionId, (r) => ({ ...r, stopRequested: true }));
      // Abort the in-flight request (it rejects with `cancelled`) …
      if (runtime.requestId) void ipc.ai.cancel(runtime.requestId);
      // … and resolve any approval the loop is currently blocked on.
      const approvals = get().approvals;
      for (const resolve of approvals.values()) resolve(false);
      approvals.clear();
    },

    approve: (toolLogId) => {
      get().approvals.get(toolLogId)?.(true);
      get().approvals.delete(toolLogId);
    },

    deny: (toolLogId) => {
      get().approvals.get(toolLogId)?.(false);
      get().approvals.delete(toolLogId);
    },
  };
});

/** Resolve once the user clicks Allow/Deny on a pending tool-call card. */
function requestApproval(
  get: () => AiStoreState,
  toolLogId: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    get().approvals.set(toolLogId, resolve);
  });
}
