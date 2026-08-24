// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ErrorBoundary } from "./error-boundary";

function BrokenView(): never {
  throw new Error("internal module path");
}

describe("ErrorBoundary", () => {
  it("shows a localized generic recovery action without internal details", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
    expect(screen.queryByText("internal module path")).toBeNull();
    consoleError.mockRestore();
  });

  it("supports an intentionally empty custom fallback", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary fallback={null}>
        <BrokenView />
      </ErrorBoundary>,
    );

    expect(container.textContent).toBe("");
    consoleError.mockRestore();
  });
});
