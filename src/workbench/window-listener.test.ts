import { describe, expect, it, vi } from "vitest";

import { installWindowListener } from "./window-listener";

describe("installWindowListener", () => {
  it("removes a listener that resolves after disposal", async () => {
    let resolve: ((cleanup: () => void) => void) | undefined;
    const cleanup = vi.fn();
    const dispose = installWindowListener(
      () =>
        new Promise((next) => {
          resolve = next;
        }),
      vi.fn(),
    );

    await vi.waitFor(() => expect(resolve).toBeDefined());
    dispose();
    resolve?.(cleanup);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
  });

  it("reports registration failures only while mounted", async () => {
    const mountedError = vi.fn();
    installWindowListener(
      () => Promise.reject(new Error("listen failed")),
      mountedError,
    );
    await vi.waitFor(() => expect(mountedError).toHaveBeenCalledOnce());

    const disposedError = vi.fn();
    const dispose = installWindowListener(
      () => Promise.reject(new Error("listen failed")),
      disposedError,
    );
    dispose();
    await vi.waitFor(() => expect(disposedError).not.toHaveBeenCalled());
    expect(disposedError).not.toHaveBeenCalled();
  });

  it("reports synchronous registration failures", async () => {
    const onError = vi.fn();
    installWindowListener(() => {
      throw new Error("unsupported");
    }, onError);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });
});
