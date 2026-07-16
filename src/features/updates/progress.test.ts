import { describe, expect, it } from "vitest";

import type { UpdateStatus } from "@/types/models";
import { updateDownloadProgress } from "./progress";

describe("update download progress", () => {
  it("starts at zero while the total size is not known yet", () => {
    const state: UpdateStatus = {
      status: "downloading",
      version: "2.3.0",
      downloaded: 0,
      total: null,
    };

    expect(updateDownloadProgress(state)).toBe(0);
  });

  it("calculates and bounds determinate progress", () => {
    expect(
      updateDownloadProgress({
        status: "downloading",
        version: "2.3.0",
        downloaded: 25,
        total: 100,
      }),
    ).toBe(25);
    expect(
      updateDownloadProgress({
        status: "downloading",
        version: "2.3.0",
        downloaded: 110,
        total: 100,
      }),
    ).toBe(100);
  });

  it("uses indeterminate progress only after bytes arrive without a total", () => {
    expect(
      updateDownloadProgress({
        status: "downloading",
        version: "2.3.0",
        downloaded: 1,
        total: null,
      }),
    ).toBeNull();
  });
});
