import { beforeEach, describe, expect, it, vi } from "vitest";

interface PasswordPrompt {
  promptId: string;
  sessionId: string;
  host: string;
  port: number;
  username: string;
  echo: boolean;
  allowEmpty: boolean;
}

const mocks = vi.hoisted(() => ({
  pendingPasswords: vi.fn(),
  respondPassword: vi.fn(() => Promise.resolve()),
  passwordListener: undefined as ((event: PasswordPrompt) => void) | undefined,
  passwordClosedListener: undefined as
    ((event: { promptId: string }) => void) | undefined,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    ssh: {
      onPassword: vi.fn((listener: (event: PasswordPrompt) => void) => {
        mocks.passwordListener = listener;
        return Promise.resolve(vi.fn());
      }),
      onPasswordClosed: vi.fn(
        (listener: (event: { promptId: string }) => void) => {
          mocks.passwordClosedListener = listener;
          return Promise.resolve(vi.fn());
        },
      ),
      pendingPasswords: mocks.pendingPasswords,
      respondPassword: mocks.respondPassword,
    },
  },
}));

import {
  hasPasswordPrompt,
  listenPasswordPrompts,
  usePasswordPromptStore,
} from "./password-prompt";

const prompt = (promptId: string, sessionId = "session-1"): PasswordPrompt => ({
  promptId,
  sessionId,
  host: "example.com",
  port: 22,
  username: "root",
  echo: false,
  allowEmpty: false,
});

describe("password prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.passwordListener = undefined;
    mocks.passwordClosedListener = undefined;
    mocks.pendingPasswords.mockResolvedValue([]);
    usePasswordPromptStore.setState({ queue: [] });
  });

  it("recovers a prompt emitted before the event listener was ready", async () => {
    mocks.pendingPasswords.mockResolvedValue([prompt("pending")]);

    await listenPasswordPrompts();

    expect(usePasswordPromptStore.getState().queue).toEqual([
      prompt("pending"),
    ]);
    expect(hasPasswordPrompt("session-1")).toBe(true);
  });

  it("deduplicates a prompt seen through both the event and pending query", async () => {
    mocks.pendingPasswords.mockImplementation(async () => {
      mocks.passwordListener?.(prompt("same"));
      return [prompt("same")];
    });

    await listenPasswordPrompts();

    expect(usePasswordPromptStore.getState().queue).toHaveLength(1);
  });

  it("does not restore a recovered prompt that closed during synchronization", async () => {
    let finishPending: ((events: PasswordPrompt[]) => void) | undefined;
    mocks.pendingPasswords.mockImplementation(
      () =>
        new Promise<PasswordPrompt[]>((resolve) => {
          finishPending = resolve;
        }),
    );
    const listening = listenPasswordPrompts();
    await vi.waitFor(() => {
      expect(mocks.passwordClosedListener).toBeTypeOf("function");
      expect(mocks.pendingPasswords).toHaveBeenCalledOnce();
    });

    mocks.passwordClosedListener?.({ promptId: "closed" });
    finishPending?.([prompt("closed")]);
    await listening;

    expect(usePasswordPromptStore.getState().queue).toEqual([]);
  });

  it("cancels every queued prompt for one connection only", () => {
    usePasswordPromptStore.setState({
      queue: [prompt("first"), prompt("second"), prompt("other", "session-2")],
    });

    usePasswordPromptStore.getState().cancelSession("session-1");

    expect(mocks.respondPassword).toHaveBeenCalledTimes(2);
    expect(mocks.respondPassword).toHaveBeenCalledWith("first", null);
    expect(mocks.respondPassword).toHaveBeenCalledWith("second", null);
    expect(usePasswordPromptStore.getState().queue).toEqual([
      prompt("other", "session-2"),
    ]);
  });

  it("restores a prompt when sending the response fails", async () => {
    mocks.respondPassword.mockRejectedValueOnce(new Error("invoke failed"));
    usePasswordPromptStore.setState({ queue: [prompt("retry")] });

    usePasswordPromptStore.getState().respond("retry", "secret");
    expect(usePasswordPromptStore.getState().queue).toEqual([]);
    await vi.waitFor(() => {
      expect(usePasswordPromptStore.getState().queue).toEqual([
        prompt("retry"),
      ]);
    });
  });

  it("dismisses a prompt when the backend stops waiting for it", async () => {
    await listenPasswordPrompts();
    mocks.passwordListener?.(prompt("closed"));

    mocks.passwordClosedListener?.({ promptId: "closed" });

    expect(usePasswordPromptStore.getState().queue).toEqual([]);
  });
});
