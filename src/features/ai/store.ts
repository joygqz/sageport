import { create } from "zustand";

import { detectLocale } from "@/i18n/config";
import { translate } from "@/i18n/translate";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { AiSessionSummary } from "@/types/models";
import { runAgentLoop, type RunnerHost } from "./runner";
import {
  buildLogFromHistory,
  deriveTitle,
  redactSensitiveHistory,
  repairHistory,
  type RuntimeSession,
} from "./transcript";

function t(key: Parameters<typeof translate>[1]): string {
  return translate(detectLocale(), key);
}

function emptyRuntime(): RuntimeSession {
  return {
    history: [],
    log: [],
    pending: false,
    activity: null,
    requestId: null,
    stopRequested: false,
    stepLimitReached: false,
    contextTokens: null,
    contextWindow: null,
    summary: "",
    summaryUpTo: 0,
  };
}

interface AiStoreState {
  sessions: AiSessionSummary[];
  sessionsLoaded: boolean;
  activeId: string | null;
  runtime: Record<string, RuntimeSession>;

  loadSessions: () => Promise<void>;

  openSession: (id: string) => Promise<void>;

  newSession: () => Promise<string>;
  deleteSession: (id: string) => Promise<void>;

  send: (
    sessionId: string,
    prompt: string,
    model: string,
    autoApprove: boolean,
    enabledTools: string[],
    maxHistoryTokens?: number | null,
  ) => Promise<void>;

  resume: (
    sessionId: string,
    model: string,
    autoApprove: boolean,
    enabledTools: string[],
    maxHistoryTokens?: number | null,
  ) => Promise<void>;

  stop: (sessionId: string) => void;
  approve: (toolLogId: string) => void;
  deny: (toolLogId: string) => void;
  answer: (toolLogId: string, option: string) => void;
}

export const useAiStore = create<AiStoreState>((set, get) => {
  const approvals = new Map<
    string,
    { sessionId: string; resolve: (approved: boolean) => void }
  >();
  const answers = new Map<
    string,
    { sessionId: string; resolve: (option: string | null) => void }
  >();
  const persistenceFailures = new Set<string>();
  const deleting = new Set<string>();
  const saveQueues = new Map<string, Promise<void>>();
  let sessionsLoad: Promise<void> | null = null;

  const patch = (id: string, fn: (r: RuntimeSession) => RuntimeSession) => {
    set((s) => {
      const current = s.runtime[id];
      if (!current) return s;
      return { runtime: { ...s.runtime, [id]: fn(current) } };
    });
  };

  const persist = async (id: string, title: string | null = null) => {
    const previous = saveQueues.get(id) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const runtime = get().runtime[id];
      if (!runtime || deleting.has(id)) return;
      try {
        const summary = await ipc.ai.session.save(
          id,
          redactSensitiveHistory(runtime.history),
          title,
        );
        persistenceFailures.delete(id);
        set((s) => ({
          sessions: [summary, ...s.sessions.filter((x) => x.id !== id)],
        }));
      } catch (err) {
        if (deleting.has(id) || !get().runtime[id]) return;
        if (!persistenceFailures.has(id)) {
          persistenceFailures.add(id);
          toast.error(t("ai.error"), errorMessage(err));
        }
      }
    });
    saveQueues.set(id, operation);
    await operation;
    if (saveQueues.get(id) === operation) {
      saveQueues.delete(id);
    }
  };

  const host: RunnerHost = {
    runtime: (sessionId) => get().runtime[sessionId],
    patch,
    persist: (sessionId) => persist(sessionId),
    requestApproval: (sessionId, toolLogId) =>
      new Promise((resolve) => {
        approvals.set(toolLogId, { sessionId, resolve });
      }),
    requestAnswer: (sessionId, toolLogId) =>
      new Promise((resolve) => {
        answers.set(toolLogId, { sessionId, resolve });
      }),
  };

  const runLoop = async (
    sessionId: string,
    model: string,
    autoApprove: boolean,
    enabledTools: string[],
    maxHistoryTokens?: number | null,
  ) => {
    try {
      await runAgentLoop(
        host,
        sessionId,
        model,
        autoApprove,
        enabledTools,
        maxHistoryTokens,
      );
    } catch (err) {
      const message = errorMessage(err);
      const content = `⚠️ ${message}`;
      toast.error(t("ai.error"), message);
      patch(sessionId, (r) => ({
        ...r,
        history: [...r.history, { role: "assistant", content }],
        log: [
          ...r.log,
          { id: crypto.randomUUID(), kind: "assistant", content },
        ],
      }));
    } finally {
      patch(sessionId, (r) => ({
        ...r,
        pending: false,
        activity: null,
        requestId: null,
        stopRequested: false,
      }));
      void persist(sessionId);
    }
  };

  return {
    sessions: [],
    sessionsLoaded: false,
    activeId: null,
    runtime: {},

    loadSessions: async () => {
      if (get().sessionsLoaded) return;
      if (!sessionsLoad) {
        sessionsLoad = (async () => {
          try {
            const sessions = await ipc.ai.session.list();
            set({ sessions, sessionsLoaded: true });
            if (sessions.length > 0) {
              await get().openSession(sessions[0].id);
            }
          } catch (err) {
            toast.error(t("ai.error"), errorMessage(err));
          } finally {
            sessionsLoad = null;
          }
        })();
      }
      await sessionsLoad;
    },

    openSession: async (id) => {
      set({ activeId: id });
      if (get().runtime[id]) return;
      try {
        const session = await ipc.ai.session.get(id);
        const history = repairHistory(session.messages);
        set((s) => ({
          runtime: {
            ...s.runtime,
            [id]: {
              ...emptyRuntime(),
              history,
              log: buildLogFromHistory(history),
            },
          },
        }));
      } catch (err) {
        if (get().activeId === id) set({ activeId: null });
        toast.error(t("ai.error"), errorMessage(err));
      }
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
        runtime: { ...s.runtime, [session.id]: emptyRuntime() },
        activeId: session.id,
      }));
      return session.id;
    },

    deleteSession: async (id) => {
      deleting.add(id);
      get().stop(id);
      try {
        await ipc.ai.session.remove(id);
      } catch (err) {
        deleting.delete(id);
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
      persistenceFailures.delete(id);
      deleting.delete(id);
    },

    send: async (
      sessionId,
      prompt,
      model,
      autoApprove,
      enabledTools,
      maxHistoryTokens,
    ) => {
      const trimmed = prompt.trim();
      const runtime = get().runtime[sessionId];
      if (!trimmed || !model || !runtime || runtime.pending) return;

      const isFirstTurn = runtime.history.length === 0;
      const title = isFirstTurn ? deriveTitle(trimmed) : null;

      patch(sessionId, (r) => ({
        ...r,
        pending: true,
        stopRequested: false,
        stepLimitReached: false,
        log: [
          ...r.log,
          { id: crypto.randomUUID(), kind: "user", content: trimmed },
        ],
        history: [...r.history, { role: "user", content: trimmed }],
      }));
      await persist(sessionId, title);
      await runLoop(
        sessionId,
        model,
        autoApprove,
        enabledTools,
        maxHistoryTokens,
      );
    },

    resume: async (
      sessionId,
      model,
      autoApprove,
      enabledTools,
      maxHistoryTokens,
    ) => {
      const runtime = get().runtime[sessionId];
      if (!model || !runtime || runtime.pending || !runtime.stepLimitReached) {
        return;
      }
      patch(sessionId, (r) => ({
        ...r,
        pending: true,
        stopRequested: false,
        stepLimitReached: false,
      }));
      await runLoop(
        sessionId,
        model,
        autoApprove,
        enabledTools,
        maxHistoryTokens,
      );
    },

    stop: (sessionId) => {
      const runtime = get().runtime[sessionId];
      if (!runtime?.pending) return;
      patch(sessionId, (r) => ({ ...r, stopRequested: true }));

      if (runtime.requestId) {
        const requestId = runtime.requestId;
        void ipc.ai
          .cancel(requestId)
          .catch(() => {})
          .finally(() => {
            globalThis.setTimeout(() => {
              const current = get().runtime[sessionId];
              if (
                current?.pending &&
                current.stopRequested &&
                current.requestId === requestId
              ) {
                void ipc.ai.cancel(requestId).catch(() => {});
              }
            }, 100);
          });
      }

      for (const [logId, entry] of approvals) {
        if (entry.sessionId !== sessionId) continue;
        entry.resolve(false);
        approvals.delete(logId);
      }

      for (const [logId, entry] of answers) {
        if (entry.sessionId !== sessionId) continue;
        entry.resolve(null);
        answers.delete(logId);
      }
    },

    approve: (toolLogId) => {
      approvals.get(toolLogId)?.resolve(true);
      approvals.delete(toolLogId);
    },

    deny: (toolLogId) => {
      approvals.get(toolLogId)?.resolve(false);
      approvals.delete(toolLogId);
    },

    answer: (toolLogId, option) => {
      answers.get(toolLogId)?.resolve(option);
      answers.delete(toolLogId);
    },
  };
});
