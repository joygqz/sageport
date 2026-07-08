import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  AiChatMessage,
  AiChatResult,
  AiConfig,
  AiProtocol,
  AiSession,
  AiSessionSummary,
  AiToolSpec,
  BatchExecEvent,
  FileEntry,
  FsEndpoint,
  GeneratedSshKey,
  Group,
  GroupInput,
  Host,
  HostHealthCheck,
  HostInput,
  HostKeyDecision,
  HostKeyEvent,
  Identity,
  IdentityInput,
  KeyFile,
  MonitorStatsEvent,
  PortForward,
  PtyDataEvent,
  PtyExitEvent,
  PortForwardInput,
  ForwardStatusEvent,
  SftpStatusEvent,
  SftpBookmark,
  SftpBookmarkInput,
  Snippet,
  SnippetInput,
  SshConfigHost,
  SshDataEvent,
  SshKey,
  SshKeyGenerateInput,
  SshKeyInput,
  SshStatusEvent,
  SyncConnectOutcome,
  SyncOAuthEvent,
  SyncProviderKind,
  SyncProviderSettings,
  SyncPushOutcome,
  SyncRestoreOutcome,
  SyncStatus,
  SyncVersion,
  TransferEvent,
  TransferHistoryEntry,
  UpdateStatus,
} from "@/types/models";

export const ipc = {
  groups: {
    list: () => invoke<Group[]>("groups_list"),
    create: (input: GroupInput) => invoke<Group>("groups_create", { input }),
    update: (id: string, input: GroupInput) =>
      invoke<Group>("groups_update", { id, input }),
    remove: (id: string, deleteHosts: boolean) =>
      invoke<void>("groups_delete", { id, deleteHosts }),
  },
  hosts: {
    list: () => invoke<Host[]>("hosts_list"),
    get: (id: string) => invoke<Host>("hosts_get", { id }),
    create: (input: HostInput) => invoke<Host>("hosts_create", { input }),
    update: (id: string, input: HostInput) =>
      invoke<Host>("hosts_update", { id, input }),
    remove: (id: string) => invoke<void>("hosts_delete", { id }),
    runCommand: (
      hostIds: string[],
      command: string,
      onEvent: (e: BatchExecEvent) => void,
    ) => {
      const channel = new Channel<BatchExecEvent>();
      channel.onmessage = onEvent;
      return invoke<void>("hosts_run_command", {
        hostIds,
        command,
        onEvent: channel,
      });
    },
    importPreview: () =>
      invoke<SshConfigHost[]>("ssh_config_import_preview"),
    importApply: (hosts: SshConfigHost[]) =>
      invoke<number>("ssh_config_import_apply", { hosts }),
    checkHealth: (
      hostIds?: string[],
      onResult?: (result: HostHealthCheck) => void,
    ) => {
      const channel = new Channel<HostHealthCheck>();
      channel.onmessage = (result) => onResult?.(result);
      return invoke<HostHealthCheck[]>("hosts_check_health", {
        hostIds,
        onResult: channel,
      });
    },
  },
  identities: {
    list: () => invoke<Identity[]>("identities_list"),
    create: (input: IdentityInput) =>
      invoke<Identity>("identities_create", { input }),
    update: (id: string, input: IdentityInput) =>
      invoke<Identity>("identities_update", { id, input }),
    remove: (id: string) => invoke<void>("identities_delete", { id }),
  },
  keys: {
    list: () => invoke<SshKey[]>("keys_list"),
    create: (input: SshKeyInput) => invoke<SshKey>("keys_create", { input }),
    update: (id: string, input: SshKeyInput) =>
      invoke<SshKey>("keys_update", { id, input }),
    remove: (id: string) => invoke<void>("keys_delete", { id }),

    generate: (input: SshKeyGenerateInput) =>
      invoke<GeneratedSshKey>("keys_generate", { input }),

    importFile: (path: string) => invoke<KeyFile>("keys_import_file", { path }),
  },
  snippets: {
    list: () => invoke<Snippet[]>("snippets_list"),
    create: (input: SnippetInput) =>
      invoke<Snippet>("snippets_create", { input }),
    update: (id: string, input: SnippetInput) =>
      invoke<Snippet>("snippets_update", { id, input }),
    remove: (id: string) => invoke<void>("snippets_delete", { id }),
  },
  settings: {
    get: (key: string) => invoke<string | null>("settings_get", { key }),
    set: (key: string, value: string) =>
      invoke<void>("settings_set", { key, value }),
    all: () => invoke<Record<string, string>>("settings_all"),
  },
  ssh: {
    connect: (params: {
      sessionId: string;
      attempt: number;
      hostId: string;
      cols: number;
      rows: number;
    }) => invoke<void>("ssh_connect", params),
    send: (sessionId: string, data: string) =>
      invoke<void>("ssh_send", { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      invoke<void>("ssh_resize", { sessionId, cols, rows }),
    disconnect: (sessionId: string) =>
      invoke<void>("ssh_disconnect", { sessionId }),
    respondHostKey: (promptId: string, decision: HostKeyDecision) =>
      invoke<void>("ssh_host_key_respond", { promptId, decision }),
    onData: (handler: (e: SshDataEvent) => void): Promise<UnlistenFn> =>
      listen<SshDataEvent>("ssh://data", (event) => handler(event.payload)),
    onStatus: (handler: (e: SshStatusEvent) => void): Promise<UnlistenFn> =>
      listen<SshStatusEvent>("ssh://status", (event) => handler(event.payload)),
    onHostKey: (handler: (e: HostKeyEvent) => void): Promise<UnlistenFn> =>
      listen<HostKeyEvent>("ssh://host-key", (event) => handler(event.payload)),
  },
  pty: {
    open: (params: { sessionId: string; cols: number; rows: number }) =>
      invoke<void>("pty_open", params),
    write: (sessionId: string, data: string) =>
      invoke<void>("pty_write", { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      invoke<void>("pty_resize", { sessionId, cols, rows }),
    close: (sessionId: string) => invoke<void>("pty_close", { sessionId }),
    onData: (handler: (e: PtyDataEvent) => void): Promise<UnlistenFn> =>
      listen<PtyDataEvent>("pty://data", (event) => handler(event.payload)),
    onExit: (handler: (e: PtyExitEvent) => void): Promise<UnlistenFn> =>
      listen<PtyExitEvent>("pty://exit", (event) => handler(event.payload)),
  },
  sftp: {
    connect: (connectionId: string, hostId: string) =>
      invoke<void>("fs_connect", { connectionId, hostId }),
    disconnect: (connectionId: string) =>
      invoke<void>("fs_disconnect", { connectionId }),
    home: (connectionId: string | null) =>
      invoke<string>("fs_home", { connectionId }),
    list: (connectionId: string | null, path: string) =>
      invoke<FileEntry[]>("fs_list", { connectionId, path }),
    mkdir: (connectionId: string | null, path: string) =>
      invoke<void>("fs_mkdir", { connectionId, path }),
    rename: (connectionId: string | null, from: string, to: string) =>
      invoke<void>("fs_rename", { connectionId, from, to }),
    remove: (connectionId: string | null, path: string, isDir: boolean) =>
      invoke<void>("fs_delete", { connectionId, path, isDir }),
    readText: (connectionId: string | null, path: string) =>
      invoke<string>("fs_read_text", { connectionId, path }),
    writeText: (connectionId: string | null, path: string, content: string) =>
      invoke<void>("fs_write_text", { connectionId, path, content }),
    chmod: (connectionId: string | null, path: string, mode: number) =>
      invoke<void>("fs_chmod", { connectionId, path, mode }),
    transfer: (
      transferId: string,
      source: FsEndpoint,
      dest: FsEndpoint,
      compress = false,
    ) => invoke<void>("fs_transfer", { transferId, source, dest, compress }),
    cancelTransfer: (transferId: string) =>
      invoke<void>("fs_transfer_cancel", { transferId }),
    historyList: (limit?: number) =>
      invoke<TransferHistoryEntry[]>("fs_history_list", { limit }),
    historyDelete: (id: string) => invoke<void>("fs_history_delete", { id }),
    historyClear: () => invoke<void>("fs_history_clear"),
    onStatus: (handler: (e: SftpStatusEvent) => void): Promise<UnlistenFn> =>
      listen<SftpStatusEvent>("sftp://status", (event) =>
        handler(event.payload),
      ),
    onTransfer: (handler: (e: TransferEvent) => void): Promise<UnlistenFn> =>
      listen<TransferEvent>("sftp://transfer", (event) =>
        handler(event.payload),
      ),
  },
  sync: {
    status: () => invoke<SyncStatus>("sync_get_status"),

    oauthStart: (
      provider: SyncProviderKind,
      onEvent: (e: SyncOAuthEvent) => void,
    ) => {
      const channel = new Channel<SyncOAuthEvent>();
      channel.onmessage = onEvent;
      return invoke<{ account: string }>("sync_oauth_start", {
        provider,
        onEvent: channel,
      });
    },

    oauthCancel: () => invoke<void>("sync_oauth_cancel"),

    connect: (input: {
      provider: SyncProviderKind;
      settings?: SyncProviderSettings;
      passphrase: string;
      force: boolean;
    }) => invoke<SyncConnectOutcome>("sync_connect", input),
    disconnect: () => invoke<void>("sync_disconnect"),

    push: () => invoke<SyncPushOutcome>("sync_push"),

    listVersions: () => invoke<SyncVersion[]>("sync_list_versions"),

    restoreVersion: (id: string) =>
      invoke<SyncRestoreOutcome>("sync_restore_version", { id }),

    fileExport: (path: string, passphrase: string) =>
      invoke<void>("sync_file_export", { path, passphrase }),
    fileImport: (path: string, passphrase: string) =>
      invoke<void>("sync_file_import", { path, passphrase }),
  },
  ai: {
    getConfig: () => invoke<AiConfig>("ai_get_config"),
    setConfig: (input: {
      baseUrl: string;
      protocol: AiProtocol;
      apiKey?: string;
    }) => invoke<void>("ai_set_config", { input }),

    listModels: () => invoke<string[]>("ai_list_models"),
    setModel: (model: string) => invoke<void>("ai_set_model", { model }),

    chat: (
      model: string,
      messages: AiChatMessage[],
      tools: AiToolSpec[],
      opts?: {
        context?: string;
        requestId?: string;
        onDelta?: (text: string) => void;
      },
    ) => {
      const onDelta = new Channel<{ type: "text"; text: string }>();
      onDelta.onmessage = (e) => opts?.onDelta?.(e.text);
      return invoke<AiChatResult>("ai_chat", {
        model,
        messages,
        tools,
        context: opts?.context ?? null,
        requestId: opts?.requestId ?? null,
        onDelta,
      });
    },

    cancel: (requestId: string) =>
      invoke<void>("ai_chat_cancel", { requestId }),
    session: {
      list: () => invoke<AiSessionSummary[]>("ai_session_list"),

      create: () => invoke<AiSession>("ai_session_create"),

      get: (id: string) => invoke<AiSession>("ai_session_get", { id }),

      save: (id: string, messages: AiChatMessage[], title: string | null) =>
        invoke<AiSessionSummary>("ai_session_save", { id, messages, title }),
      rename: (id: string, title: string) =>
        invoke<AiSessionSummary>("ai_session_rename", { id, title }),
      remove: (id: string) => invoke<void>("ai_session_delete", { id }),
    },
  },
  history: {
    add: (hostId: string | null, command: string) =>
      invoke<void>("history_add", { hostId, command }),
    search: (hostId: string | null, prefix: string, limit?: number) =>
      invoke<string[]>("history_search", { hostId, prefix, limit }),
    clear: () => invoke<void>("history_clear"),
  },
  monitor: {
    start: (sessionId: string) => invoke<void>("monitor_start", { sessionId }),
    stop: (sessionId: string) => invoke<void>("monitor_stop", { sessionId }),
    onStats: (handler: (e: MonitorStatsEvent) => void): Promise<UnlistenFn> =>
      listen<MonitorStatsEvent>("monitor://stats", (event) =>
        handler(event.payload),
      ),
  },
  bookmarks: {
    list: () => invoke<SftpBookmark[]>("bookmarks_list"),
    create: (input: SftpBookmarkInput) =>
      invoke<SftpBookmark>("bookmarks_create", { input }),
    remove: (id: string) => invoke<void>("bookmarks_delete", { id }),
  },
  forwards: {
    list: () => invoke<PortForward[]>("forwards_list"),
    active: () => invoke<string[]>("forwards_active"),
    create: (input: PortForwardInput) =>
      invoke<PortForward>("forwards_create", { input }),
    update: (id: string, input: PortForwardInput) =>
      invoke<PortForward>("forwards_update", { id, input }),
    remove: (id: string) => invoke<void>("forwards_delete", { id }),
    start: (id: string) => invoke<void>("forward_start", { id }),
    stop: (id: string) => invoke<void>("forward_stop", { id }),
    onStatus: (handler: (e: ForwardStatusEvent) => void): Promise<UnlistenFn> =>
      listen<ForwardStatusEvent>("forward://status", (event) =>
        handler(event.payload),
      ),
  },
  window: {
    setTrafficLightInset: (x: number, height: number) =>
      invoke<void>("window_set_traffic_light_inset", { x, height }),
  },
  update: {
    status: () => invoke<UpdateStatus>("update_status"),
    check: () => invoke<UpdateStatus>("update_check"),
    install: () => invoke<UpdateStatus>("update_install"),
    onStatus: (handler: (e: UpdateStatus) => void): Promise<UnlistenFn> =>
      listen<UpdateStatus>("update://status", (event) => handler(event.payload)),
  },
};
