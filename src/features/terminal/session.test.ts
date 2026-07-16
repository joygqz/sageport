import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalTransport } from "./transport";

const terminal = vi.hoisted(() => ({
  rows: 24,
  cols: 80,
  options: { fontSize: 13, fontFamily: "monospace" } as Record<string, unknown>,
  buffer: { active: { length: 0, type: "normal" } },
  onData: vi.fn(() => ({ dispose: vi.fn() })),
  onResize: vi.fn(() => ({ dispose: vi.fn() })),
  open: vi.fn(),
  focus: vi.fn(),
  refresh: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("./xterm", () => ({
  createTerminal: () => ({
    term: terminal,
    fit: {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    },
    search: {},
  }),
  attachWebglRenderer: vi.fn(),
}));

import { CONNECT_TIMEOUT_MS, TerminalSession } from "./session";

function transport(
  overrides: Partial<TerminalTransport> = {},
): TerminalTransport {
  return {
    connect: vi.fn(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve()),
    resize: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    onData: vi.fn(() => Promise.resolve(() => {})),
    onStatus: vi.fn(() => Promise.resolve(() => {})),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", {
    fonts: { load: vi.fn(() => Promise.resolve()) },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => vi.useRealTimers());

describe("TerminalSession lifecycle", () => {
  it("reports a transport connect failure", async () => {
    const events: Array<{ status: string; message?: string }> = [];
    const session = new TerminalSession({
      id: "session-1",
      connectionKey: "attempt-1",
      transport: transport({
        connect: vi.fn(() => Promise.reject(new Error("connect failed"))),
      }),
      fontFamily: "monospace",
      fontSize: 13,
      theme: {},
      watchHostKey: false,
      imagePaste: false,
      onStatus: (event) => events.push(event),
    });

    session.attach({} as HTMLElement);

    await vi.waitFor(() =>
      expect(events.map((event) => event.status)).toEqual([
        "connecting",
        "error",
      ]),
    );
    expect(events[1]?.message).toContain("connect failed");
    session.dispose();
  });

  it("disconnects the transport exactly once when disposed repeatedly", () => {
    const current = transport();
    const session = new TerminalSession({
      id: "session-1",
      connectionKey: "attempt-1",
      transport: current,
      fontFamily: "monospace",
      fontSize: 13,
      theme: {},
      watchHostKey: false,
      imagePaste: false,
      onStatus: vi.fn(),
    });

    session.dispose();
    session.dispose();

    expect(current.disconnect).toHaveBeenCalledTimes(1);
  });

  it("fails and releases the transport after the configured timeout", async () => {
    vi.useFakeTimers();
    const current = transport();
    const events: Array<{ status: string; code?: string | null }> = [];
    const session = new TerminalSession({
      id: "session-1",
      connectionKey: "attempt-1",
      transport: current,
      fontFamily: "monospace",
      fontSize: 13,
      theme: {},
      watchHostKey: false,
      imagePaste: false,
      onStatus: (event) => events.push(event),
    });

    session.attach({} as HTMLElement);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.map((event) => event.status)).toEqual(["connecting"]);

    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);

    expect(events.at(-1)).toEqual({ status: "error", code: "timeout" });
    expect(current.disconnect).toHaveBeenCalledTimes(1);
    session.dispose();
  });
});
