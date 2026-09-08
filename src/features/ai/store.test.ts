import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LocaleConfig from "@/i18n/config";

const { runAgentLoop, save, get } = vi.hoisted(() => ({
  runAgentLoop: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
}));

vi.mock("./runner", () => ({ runAgentLoop }));
vi.mock("@/i18n/config", async (original) => ({
  ...(await original<typeof LocaleConfig>()),
  detectLocale: () => "en",
}));
vi.mock("@/lib/ipc", () => ({ ipc: { ai: { session: { save, get } } } }));

import { useAiStore } from "./store";
import type { AiImageAttachment } from "@/types/models";

const image: AiImageAttachment = {
  id: "image-1",
  name: "screen.png",
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
  width: 1,
  height: 1,
};
const summary = {
  id: "chat",
  title: "Image chat",
  createdAt: "2026-09-08",
  updatedAt: "2026-09-08",
};

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue(summary);
  runAgentLoop.mockResolvedValue(undefined);
  useAiStore.setState({
    activeId: "chat",
    sessions: [summary],
    runtime: {
      chat: {
        history: [],
        log: [],
        pending: false,
        activity: null,
        requestId: null,
        stopRequested: false,
        stepLimitReached: false,
      },
    },
  });
});

describe("image conversation lifecycle", () => {
  it("sends and persists an image-only user turn", async () => {
    await useAiStore
      .getState()
      .send("chat", "", "vision-model", false, [], null, [image]);
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(useAiStore.getState().runtime.chat.history[0]).toMatchObject({
      role: "user",
      content: "",
      images: [image],
    });
    expect(save.mock.calls[0][1][0].images).toEqual([image]);
    expect(useAiStore.getState().runtime.chat.log[0]).toMatchObject({
      kind: "user",
      images: [image],
    });
  });

  it("restores image attachments when reopening a saved conversation", async () => {
    useAiStore.setState({ runtime: {} });
    get.mockResolvedValue({
      ...summary,
      messages: [{ role: "user", images: [image] }],
    });
    await useAiStore.getState().openSession("chat");
    expect(useAiStore.getState().runtime.chat.log[0]).toMatchObject({
      kind: "user",
      images: [image],
    });
  });
});
