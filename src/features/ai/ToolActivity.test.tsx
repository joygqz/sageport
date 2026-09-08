import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

import { I18nContext } from "@/i18n/i18n-context";
import { translate } from "@/i18n/translate";
import { ToolActivity } from "./ToolActivity";

function renderApproval(args: Record<string, unknown>) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        locale: "en",
        setLocale: () => {},
        t: (key, params) => translate("en", key, params),
      }}
    >
      <ToolActivity
        item={{
          id: "approval",
          kind: "tool",
          toolCallId: "call",
          name: "write_file",
          args,
          status: "awaiting-approval",
        }}
        onApprove={() => {}}
        onDeny={() => {}}
      />
    </I18nContext.Provider>,
  );
}

describe("operation review", () => {
  it("shows the complete file content, including changes beyond 4096 characters", () => {
    const html = renderApproval({
      path: "/etc/app.conf",
      content: "a".repeat(5000) + "review-this-tail",
    });
    expect(html).toContain("review-this-tail");
    expect(html).not.toContain("more characters");
  });

  it("masks nested credentials while keeping the terminal target visible", () => {
    const html = renderApproval({
      sessionId: "production-terminal",
      apiKey: "secret-api-key",
      nested: { privateKey: "secret-private-key" },
    });
    expect(html).toContain("production-terminal");
    expect(html).not.toContain("secret-api-key");
    expect(html).not.toContain("secret-private-key");
  });
});
