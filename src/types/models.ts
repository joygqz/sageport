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
  notes: string | null;
  jumpHostId: string | null;
  startupCommand: string | null;
  hasPassword: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export type BatchExecStatus = "queued" | "running" | "done" | "error";

export interface BatchExecEvent {
  hostId: string;
  status: BatchExecStatus;
  output?: string;
  exitCode?: number;
  message?: string;
}

export interface HostStats {
  cpuLoad: number;
  cpuCount: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  os?: string;
  uptimeSecs?: number;
  netRxRate?: number;
  netTxRate?: number;
}

export interface MonitorStatsEvent {
  sessionId: string;
  attempt: number;
  stats?: HostStats;
  unsupported: boolean;
}

export interface SftpBookmark {
  id: string;
  hostId: string | null;
  label: string;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface SftpBookmarkInput {
  hostId?: string | null;
  label: string;
  path: string;
}

export type ForwardKind = "local" | "remote" | "dynamic";

export interface PortForward {
  id: string;
  hostId: string;
  label: string;
  kind: ForwardKind;
  bindHost: string;
  bindPort: number;
  targetHost: string | null;
  targetPort: number | null;
  autoStart: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface PortForwardInput {
  hostId: string;
  label: string;
  kind: ForwardKind;
  bindHost?: string;
  bindPort: number;
  targetHost?: string | null;
  targetPort?: number | null;
  autoStart?: boolean;
}

export type ForwardStatusKind = "starting" | "active" | "error" | "stopped";

export interface ForwardStatusEvent {
  forwardId: string;
  status: ForwardStatusKind;
  message?: string;
  code?: string;
  generation: number;
  sequence: number;
  publicBindRestricted: boolean;
}

export interface SshConfigHost {
  alias: string;
  hostName: string;
  user: string | null;
  port: number;
  identityFile: string | null;
  proxyJump: string | null;
  existing: boolean;
  warnings: string[];
}

export type HostHealthStatus = "online" | "offline";
export type HostHealthErrorKind =
  "timeout" | "refused" | "dns" | "invalidPort" | "network" | "unknown";

export interface HostHealthCheck {
  hostId: string;
  status: HostHealthStatus;
  latencyMs: number | null;
  checkedAt: string;
  errorKind: HostHealthErrorKind | null;
  error: string | null;
}

export interface Identity {
  id: string;
  name: string;
  username: string;
  authType: AuthType;
  keyId: string | null;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface SshKey {
  id: string;
  name: string;
  publicKey: string | null;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
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

export interface CommandHistoryEntry {
  id: string;
  hostId: string;
  hostLabel: string | null;
  command: string;
  usedAt: string;
  useCount: number;
}

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
  notes?: string | null;
  jumpHostId?: string | null;
  startupCommand?: string | null;

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

export type SshKeyAlgorithm =
  "ed25519" | "ecdsaP256" | "ecdsaP384" | "ecdsaP521" | "rsa2048" | "rsa4096";

export interface SshKeyGenerateInput {
  name: string;
  algorithm: SshKeyAlgorithm;
  passphrase?: string | null;
}

export interface GeneratedSshKey extends SshKey {
  fingerprint: string;
  algorithm: string;
}

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

export type TaskStep =
  | { type: "localCommand"; cwd?: string; command: string; continueOnError?: boolean }
  | {
      type: "upload";
      localPath: string;
      remotePath: string;
      incremental?: boolean;
      continueOnError?: boolean;
    }
  | { type: "download"; remotePath: string; localPath: string; continueOnError?: boolean }
  | { type: "remoteCommand"; cwd?: string; command: string; continueOnError?: boolean };

export type TaskStepType = TaskStep["type"];

export interface Task {
  id: string;
  name: string;
  description: string | null;
  hostId: string | null;
  steps: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  revision: number;
}

export interface TaskInput {
  name: string;
  description?: string | null;
  hostId?: string | null;
  steps: TaskStep[];
}

export type TaskRunStatus = "start" | "log" | "done" | "error" | "skipped";

export interface TaskRunEvent {
  stepIndex: number;
  status: TaskRunStatus;
  chunk?: string;
  exitCode?: number;
  message?: string;
}

export type AiProtocol = "openai" | "anthropic";

export interface AiConfig {
  hasApiKey: boolean;
  baseUrl: string;
  protocol: AiProtocol;
  model: string;
  autoApprove: boolean;
  enabledTools: string[] | null;
  maxHistoryTokens: number | null;
}

export type AiRole = "system" | "user" | "assistant" | "tool";

export interface AiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface AiChatMessage {
  role: AiRole;
  content?: string;

  toolCalls?: AiToolCall[];

  toolCallId?: string;

  toolError?: boolean;

  untrustedSource?: boolean;
}

export interface AiToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface AiChatResult {
  content?: string;
  toolCalls?: AiToolCall[];
  usage?: AiUsage;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiModelLimits {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export interface AiSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiSession extends AiSessionSummary {
  messages: AiChatMessage[];
}

export type SyncProviderKind = "gist" | "gdrive" | "onedrive" | "webdav" | "s3";

export interface SyncStatus {
  provider: SyncProviderKind | null;

  account: string | null;

  detail: string | null;

  lastSyncedAt: string | null;
  autoSyncInProgress: boolean;
  autoSyncError: string | null;

  oauthReady: { gist: boolean; gdrive: boolean; onedrive: boolean };
}

export type SyncConnectOutcome =
  { status: "connected" } | { status: "passphraseMismatch" };

export type SyncPushOutcome = { status: "pushed" } | { status: "unchanged" };

export interface SyncRestoreOutcome {
  remoteSynced: boolean;
}

export type SyncOAuthEvent =
  | { type: "deviceCode"; userCode: string; verificationUri: string }
  | { type: "browser" };

export type SyncProviderSettings =
  | { url: string; username: string; password: string }
  | {
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      accessKey: string;
      secretKey: string;
      pathStyle: boolean;
    };

export interface SyncVersion {
  id: string;
  createdAt: string;
  sizeBytes: number | null;
}

export type SshStatusKind = "connecting" | "connected" | "closed" | "error";

export interface SshStatusEvent {
  id: string;

  attempt: number;
  status: SshStatusKind;
  message?: string;

  code?: string;
}

export interface SshDataEvent {
  id: string;

  attempt: number;

  data: string;
}

export interface PtyDataEvent {
  id: string;
  attempt: number;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  attempt: number;
  code: number;
}

export type HostKeyStatus = "unknown" | "changed";
export type HostKeyDecision = "reject" | "once" | "remember";

export interface HostKeyEvent {
  promptId: string;
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  status: HostKeyStatus;
}

export interface HostKeyPromptClosedEvent {
  promptId: string;
}

export interface PasswordPromptEvent {
  promptId: string;
  sessionId: string;
  host: string;
  port: number;
  username: string;
  prompt?: string;
  instructions?: string;
  echo: boolean;
  allowEmpty: boolean;
}

export interface PasswordPromptClosedEvent {
  promptId: string;
}

export interface AppError {
  code: string;
  message: string;
}

export type FileKind = "file" | "dir" | "symlink";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number;

  modified: number | null;

  permissions: number | null;
  isSymlink: boolean;
  hidden?: boolean;
}

export type SftpStatusKind = "connecting" | "connected" | "closed" | "error";

export interface SftpStatusEvent {
  connectionId: string;
  status: SftpStatusKind;
  message?: string;

  code?: string;
}

export type TransferStatus = "active" | "done" | "error" | "cancelled";

export type TransferPhase =
  "preparing" | "compressing" | "transferring" | "extracting";

export type DeletePhase = "scanning" | "deleting";

export interface TransferEvent {
  transferId: string;
  transferred: number;
  total: number;
  file: string;
  status: TransferStatus;
  phase?: TransferPhase;
  message?: string;
  code?: string;
}

export interface DeleteEvent {
  operationId: string;
  connectionId: string | null;
  completed: number;
  total: number;
  currentPath: string;
  status: TransferStatus;
  phase?: DeletePhase;
  message?: string;
  code?: string;
}

export interface FsEndpoint {
  connectionId: string | null;
  path: string;
}

export interface TransferHistoryEntry {
  id: string;
  sourceLabel: string;
  sourcePath: string;
  sourceConnectionId: string | null;
  sourceHostLabel: string | null;
  destPath: string;
  destConnectionId: string | null;
  destHostLabel: string | null;
  totalBytes: number;
  transferredBytes: number;
  status: TransferStatus;
  message?: string;
  startedAt: string;
  finishedAt: string | null;
}

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
  | {
      status: "error";
      operation: "check" | "install";
      message: string;
    };
