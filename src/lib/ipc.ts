import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  AiChatMessage,
  AiChatResult,
  AiConfig,
  AiProtocol,
  AiSession,
  AiSessionSummary,
  AiToolSpec,
  FileEntry,
  FsEndpoint,
  GeneratedSshKey,
  GistVersion,
  Group,
  GroupInput,
  Host,
  HostInput,
  Identity,
  IdentityInput,
  KeyFile,
  SftpStatusEvent,
  Snippet,
  SnippetInput,
  SshDataEvent,
  SshKey,
  SshKeyGenerateInput,
  SshKeyInput,
  SshStatusEvent,
  SyncConfig,
  SyncConnectOutcome,
  TransferEvent,
  TransferHistoryEntry,
} from "@/types/models";

/**
 * Typed façade over the Tauri command/event boundary. Every backend command is
 * exposed here as a strongly-typed function so feature code never touches raw
 * `invoke` string names.
 */
export const ipc = {
  groups: {
    list: () => invoke<Group[]>("groups_list"),
    create: (input: GroupInput) => invoke<Group>("groups_create", { input }),
    update: (id: string, input: GroupInput) =>
      invoke<Group>("groups_update", { id, input }),
    remove: (id: string) => invoke<void>("groups_delete", { id }),
  },
  hosts: {
    list: () => invoke<Host[]>("hosts_list"),
    get: (id: string) => invoke<Host>("hosts_get", { id }),
    create: (input: HostInput) => invoke<Host>("hosts_create", { input }),
    update: (id: string, input: HostInput) =>
      invoke<Host>("hosts_update", { id, input }),
    remove: (id: string) => invoke<void>("hosts_delete", { id }),
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
    /** Generate a new keypair and persist it in one step. */
    generate: (input: SshKeyGenerateInput) =>
      invoke<GeneratedSshKey>("keys_generate", { input }),
    /** Read a key file (and sibling `.pub`, if any) picked via the file dialog. */
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
    onData: (handler: (e: SshDataEvent) => void): Promise<UnlistenFn> =>
      listen<SshDataEvent>("ssh://data", (event) => handler(event.payload)),
    onStatus: (handler: (e: SshStatusEvent) => void): Promise<UnlistenFn> =>
      listen<SshStatusEvent>("ssh://status", (event) => handler(event.payload)),
  },
  sftp: {
    /** `connectionId` of null/undefined targets the local filesystem. */
    connect: (connectionId: string, hostId: string) =>
      invoke<void>("sftp_connect", { connectionId, hostId }),
    disconnect: (connectionId: string) =>
      invoke<void>("sftp_disconnect", { connectionId }),
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
    transfer: (
      transferId: string,
      source: FsEndpoint,
      dest: FsEndpoint,
      compress = false,
    ) => invoke<void>("fs_transfer", { transferId, source, dest, compress }),
    cancelTransfer: (transferId: string) =>
      invoke<void>("fs_transfer_cancel", { transferId }),
    historyList: (limit?: number) =>
      invoke<TransferHistoryEntry[]>("sftp_transfer_history_list", { limit }),
    historyDelete: (id: string) =>
      invoke<void>("sftp_transfer_history_delete", { id }),
    historyClear: () => invoke<void>("sftp_transfer_history_clear"),
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
    getConfig: () => invoke<SyncConfig>("sync_get_config"),
    /** Link a device to a GitHub account; see `SyncConnectOutcome`. */
    connect: (token: string, passphrase: string, force: boolean) =>
      invoke<SyncConnectOutcome>("sync_connect", { token, passphrase, force }),
    disconnect: () => invoke<void>("sync_disconnect"),
    /** Merge remote + local, then push; resolves to the gist id. */
    push: () => invoke<string>("sync_push"),
    /** Newest-first backup history for the linked gist. */
    listVersions: () => invoke<GistVersion[]>("sync_list_gist_versions"),
    /** Destructive: replaces local data with the chosen revision. */
    restoreVersion: (sha: string) =>
      invoke<void>("sync_restore_gist_version", { sha }),
    /** `passphrase` is entered manually each call and never persisted. */
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
    /** Fetch the provider's available model ids for the chat-window picker. */
    listModels: () => invoke<string[]>("ai_list_models"),
    setModel: (model: string) => invoke<void>("ai_set_model", { model }),
    /** One agent turn: send the conversation so far, get the next one back. */
    chat: (model: string, messages: AiChatMessage[], tools: AiToolSpec[]) =>
      invoke<AiChatResult>("ai_chat", { model, messages, tools }),
    session: {
      /** Newest-first list of saved chat sessions, for the history menu. */
      list: () => invoke<AiSessionSummary[]>("ai_session_list"),
      /** Start a brand new, empty session. */
      create: () => invoke<AiSession>("ai_session_create"),
      /** Load one session's full conversation. */
      get: (id: string) => invoke<AiSession>("ai_session_get", { id }),
      /** Persist the conversation after a turn (title only on first turn). */
      save: (id: string, messages: AiChatMessage[], title: string | null) =>
        invoke<AiSessionSummary>("ai_session_save", { id, messages, title }),
      rename: (id: string, title: string) =>
        invoke<AiSessionSummary>("ai_session_rename", { id, title }),
      remove: (id: string) => invoke<void>("ai_session_delete", { id }),
    },
  },
};
