// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import { I18nProvider } from "@/i18n";
import type { Group, Host, Identity, SshKey } from "@/types/models";
import { HostFormDialog } from "./HostFormDialog";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
}));

const group: Group = {
  id: "group-1",
  name: "Production",
  parentId: null,
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  revision: 1,
};

const host: Host = {
  id: "host-1",
  label: "web",
  address: "10.0.0.4",
  port: 22,
  groupId: "group-1",
  identityId: null,
  username: "root",
  authType: "password",
  keyId: null,
  osHint: null,
  notes: null,
  jumpHostId: null,
  startupCommand: null,
  hasPassword: true,
  lastUsedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
  revision: 1,
};

vi.mock("@/lib/ipc", () => ({
  ipc: {
    groups: { list: vi.fn(async () => [group]) },
    hosts: {
      list: vi.fn(async () => [host]),
      get: vi.fn(async () => host),
      update: vi.fn(async () => host),
      create: vi.fn(async () => host),
    },
    keys: { list: vi.fn(async (): Promise<SshKey[]> => []) },
    identities: { list: vi.fn(async (): Promise<Identity[]> => []) },
    settings: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    },
  },
}));

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <HostFormDialog
          open
          hostId="host-1"
          initialGroupId={null}
          onClose={() => undefined}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("HostFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the host group when editing a grouped host", async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByDisplayValue("web")).toBeTruthy();
    });

    const groupTrigger = screen
      .getAllByRole("combobox")
      .find((element) => element.textContent === "Production");
    expect(groupTrigger).toBeTruthy();
    expect(
      screen
        .queryAllByRole("combobox")
        .some((element) => element.textContent === "No group"),
    ).toBe(false);
  });
});
