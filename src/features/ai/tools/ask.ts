import { MessageCircleQuestion } from "lucide-react";

import {
  targetTerminalId,
  terminalTabs,
  useTabsStore,
  type TerminalTab,
} from "@/workbench/tabs";
import type { AiTool, PreparedCall } from "./types";

export function askUserOptions(args: Record<string, unknown>): string[] {
  if (!Array.isArray(args.options)) return [];
  return args.options
    .filter((o): o is string => typeof o === "string")
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 6);
}

export function askUserQuestion(args: Record<string, unknown>): string {
  return typeof args.question === "string" ? args.question.trim() : "";
}

export function selectionResult(option: string): string {
  return `The user selected: ${option}`;
}

const TARGET_QUESTION_RE =
  /\b(?:host|server|terminal|session|machine)\b|主机|服务器|终端|会话|哪台|哪个环境/i;
const CURRENT_OPTION_RE = /\bcurrent\b|当前|正在查看|正在使用/i;
const MULTI_TARGET_RE =
  /\b(?:both|all|every|each)\b|两台|全部|所有|每台|分别|都(?:查看|检查|执行|运行)/i;

function comparableText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCurrentTab(): TerminalTab | null {
  const state = useTabsStore.getState();
  const id = targetTerminalId(state);
  return terminalTabs(state.tabs).find((s) => s.id === id) ?? null;
}

export function defaultTerminalOption(
  args: Record<string, unknown>,
  userPrompt: string,
): { option: string; tab: TerminalTab } | null {
  const question = askUserQuestion(args);
  const options = askUserOptions(args);
  if (!question || options.length < 2 || !TARGET_QUESTION_RE.test(question)) {
    return null;
  }

  const state = useTabsStore.getState();
  const current = resolveCurrentTab();
  if (!current || current.status !== "connected") return null;

  const prompt = comparableText(userPrompt);
  if (MULTI_TARGET_RE.test(prompt)) return null;

  const otherTargets = terminalTabs(state.tabs).filter(
    (tab) => tab.id !== current.id,
  );
  if (
    otherTargets.some((tab) => {
      const title = comparableText(tab.title);
      return title.length >= 3 && prompt.includes(title);
    })
  ) {
    return null;
  }

  const currentTitle = comparableText(current.title);
  const explicitlyNamedOption = options.some((candidate) => {
    const normalized = comparableText(candidate);
    const describesCurrent =
      CURRENT_OPTION_RE.test(candidate) ||
      normalized === currentTitle ||
      (currentTitle.length >= 3 && normalized.includes(currentTitle));
    return (
      !describesCurrent &&
      !MULTI_TARGET_RE.test(candidate) &&
      normalized.length >= 3 &&
      prompt.includes(normalized)
    );
  });
  if (explicitlyNamedOption) return null;

  const option = options.find((candidate) => {
    const normalized = comparableText(candidate);
    return (
      CURRENT_OPTION_RE.test(candidate) ||
      normalized === currentTitle ||
      (currentTitle.length >= 3 && normalized.includes(currentTitle)) ||
      normalized.includes(comparableText(current.id))
    );
  });
  return option ? { option, tab: current } : null;
}

export function automaticTerminalSelectionResult(
  option: string,
  tab: TerminalTab,
): string {
  return `The app automatically selected the current terminal: ${option} (title: "${tab.title}", sessionId: ${tab.id}). Continue without asking the user to choose a server.`;
}

function prepareAskUser(
  args: Record<string, unknown>,
  meta: { userPrompt: string },
): PreparedCall {
  const selection = defaultTerminalOption(args, meta.userPrompt);
  if (selection) {
    return {
      args,
      automaticResult: automaticTerminalSelectionResult(
        selection.option,
        selection.tab,
      ),
    };
  }
  return { args };
}

export const askTools: AiTool[] = [
  {
    spec: {
      name: "ask_user",
      description:
        "Show 2-6 choice buttons when a real choice remains. Never use it to confirm the current-terminal default or a command; write short options in the user's language.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to show above the options.",
          },
          options: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 6,
            description:
              "2-6 short, mutually exclusive choices. Include a broader option like 'Both' or 'All of them' when it makes sense.",
          },
        },
        required: ["question", "options"],
        additionalProperties: false,
      },
    },
    icon: MessageCircleQuestion,
    labelKey: "ai.tool.askUser",
    prepare: prepareAskUser,
  },
];
