/**
 * TypeScript mirror of the Rust domain models (`src-tauri/src/domain`).
 * Kept in sync by hand for now; a future enhancement is generating these from
 * the Rust types (e.g. via `tauri-specta`) to remove the duplication.
 */

export type AuthType = "password" | "key" | "agent";

export interface Group {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface Host {
  id: string;
  label: string;
  address: string;
  port: number;
  groupId: string | null;
  identityId: string | null;
  username: string | null;
  authType: AuthType | null;
  keyId: string | null;
  osHint: string | null;
  color: string | null;
  notes: string | null;
  password: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface Identity {
  id: string;
  name: string;
  username: string;
  authType: AuthType;
  keyId: string | null;
  password: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface SshKey {
  id: string;
  name: string;
  publicKey: string | null;
  privateKey: string | null;
  passphrase: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

// --- Input payloads (match the Rust *Input structs) ---

export interface GroupInput {
  name: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface HostInput {
  label: string;
  address: string;
  port?: number;
  groupId?: string | null;
  identityId?: string | null;
  username?: string | null;
  authType?: AuthType | null;
  keyId?: string | null;
  osHint?: string | null;
  color?: string | null;
  notes?: string | null;
  /** Stored inline on the host row. */
  password?: string | null;
}

export interface IdentityInput {
  name: string;
  username: string;
  authType?: AuthType;
  keyId?: string | null;
  password?: string | null;
}

export interface SshKeyInput {
  name: string;
  publicKey?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
}

/** Algorithm choice for `keys.generate`. */
export type SshKeyAlgorithm =
  "ed25519" | "ecdsaP256" | "ecdsaP384" | "ecdsaP521" | "rsa2048" | "rsa4096";

export interface SshKeyGenerateInput {
  name: string;
  algorithm: SshKeyAlgorithm;
  passphrase?: string | null;
}

/** `keys.generate`'s response: the persisted key plus a one-time summary. */
export interface GeneratedSshKey extends SshKey {
  fingerprint: string;
  algorithm: string;
}

/** A private key file read via `keys.importFile`, for prefilling the import form. */
export interface KeyFile {
  name: string;
  privateKey: string;
  publicKey: string | null;
  fingerprint: string | null;
  algorithm: string | null;
}

export interface SnippetInput {
  name: string;
  command: string;
  description?: string | null;
}

/** Wire format spoken by the configured AI endpoint. */
export type AiProtocol = "openai" | "anthropic";

export interface AiConfig {
  hasApiKey: boolean;
  baseUrl: string;
  protocol: AiProtocol;
  model: string;
}

/** Canonical (provider-agnostic) conversation role. */
export type AiRole = "system" | "user" | "assistant" | "tool";

/** One tool invocation, requested by the model or reported back to it. */
export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

/**
 * One turn of the canonical conversation sent to `ai_chat`. Never include a
 * `system` message — the backend always supplies its own.
 */
export interface AiChatMessage {
  role: AiRole;
  content?: string;
  /** Present on an `assistant` message that requested tool calls. */
  toolCalls?: AiToolCall[];
  /** Present on a `tool` message: which call this answers. */
  toolCallId?: string;
}

/** JSON-Schema description of a tool the frontend can execute. */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

/** One model turn: a text reply and/or a batch of tool calls to run. */
export interface AiChatResult {
  content?: string;
  toolCalls?: AiToolCall[];
}

/** Lightweight view of a saved chat session, for the history list. */
export interface AiSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A saved chat session's full conversation, loaded when opened. */
export interface AiSession extends AiSessionSummary {
  messages: AiChatMessage[];
}

/** Non-secret view of the GitHub Gist sync configuration. */
export interface SyncConfig {
  /** Whether a GitHub token is stored (the token itself is never exposed). */
  hasToken: boolean;
  /** Whether a vault passphrase is stored (never exposed). */
  hasPassphrase: boolean;
  /** Id of the linked vault gist, once known (pushed or auto-discovered). */
  gistId: string | null;
  /** ISO timestamp of the last successful push/restore, if any. */
  lastSyncedAt: string | null;
}

/** Result of `sync.connect`: either linked, or blocked on a passphrase that
 * doesn't decrypt the account's existing backup (see `sync.connect`). */
export type SyncConnectOutcome =
  | { status: "connected"; gistId: string | null }
  | { status: "passphraseMismatch"; gistId: string };

/** One historical revision of the vault gist (see `sync.listVersions`). */
export interface GistVersion {
  sha: string;
  committedAt: string;
  additions: number;
  deletions: number;
}

// --- SSH event payloads (emitted from Rust) ---

export type SshStatusKind = "connecting" | "connected" | "closed" | "error";

export interface SshStatusEvent {
  id: string;
  status: SshStatusKind;
  message?: string;
}

export interface SshDataEvent {
  id: string;
  /** Base64-encoded raw terminal bytes. */
  data: string;
}

export interface AppError {
  code: string;
  message: string;
}

// --- SFTP / filesystem (emitted from / consumed by the Rust SFTP layer) ---

export type FileKind = "file" | "dir" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  /** Unix seconds, when known. */
  modified: number | null;
  /** Unix permission bits, when known. */
  permissions: number | null;
  isSymlink: boolean;
}

export type SftpStatusKind = "connecting" | "connected" | "closed" | "error";

export interface SftpStatusEvent {
  connectionId: string;
  status: SftpStatusKind;
  message?: string;
}

export type TransferStatus = "active" | "done" | "error" | "cancelled";

/** Phase of a compressed transfer; absent for a plain byte-for-byte copy. */
export type TransferPhase = "compressing" | "transferring" | "extracting";

export interface TransferEvent {
  transferId: string;
  transferred: number;
  total: number;
  file: string;
  status: TransferStatus;
  phase?: TransferPhase;
  message?: string;
}

/** One end of a transfer: `connectionId` null/undefined means the local FS. */
export interface FsEndpoint {
  connectionId: string | null;
  path: string;
}

/** A persisted transfer history record ("active" while still in flight). */
export interface TransferHistoryEntry {
  id: string;
  sourceLabel: string;
  sourcePath: string;
  sourceConnectionId: string | null;
  destPath: string;
  destConnectionId: string | null;
  totalBytes: number;
  transferredBytes: number;
  status: TransferStatus;
  message?: string;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Lives in the Rust backend (`update::UpdateManager`), not component state —
 * so it survives the Settings dialog being closed and reopened mid-download.
 */
export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "available"; version: string; body: string | null }
  | {
      status: "downloading";
      version: string;
      downloaded: number;
      total: number | null;
    }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };
