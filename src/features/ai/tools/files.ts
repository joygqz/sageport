import {
  ArrowRightLeft,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  KeyRound,
  SquarePen,
  Trash2,
} from "lucide-react";

import { octalToMode } from "@/features/sftp/permissions";
import { parentPath, useSftpStore } from "@/features/sftp/store";
import { ipc } from "@/lib/ipc";
import { errorMessage } from "@/lib/toast";
import type { SftpStatusKind } from "@/types/models";
import type { FsEndpoint, TransferEvent } from "@/types/models";
import { resolveTerminalTab, sleep } from "./terminal";
import {
  bool,
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type PreparedCall,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

const aiConnByHost = new Map<string, string>();
const connStatus = new Map<string, SftpStatusKind>();
let bridged = false;

function bridgeAiSftp(): void {
  if (bridged) return;
  bridged = true;
  void ipc.sftp.onStatus((e) => connStatus.set(e.connectionId, e.status));
}

function reuseTabConnection(hostId: string): string | undefined {
  const { panes } = useSftpStore.getState();
  for (const side of ["left", "right"] as const) {
    const tab = panes[side].tabs.find(
      (t) =>
        t.kind === "remote" &&
        t.hostId === hostId &&
        t.status === "connected" &&
        t.connectionId,
    );
    if (tab?.connectionId) return tab.connectionId;
  }
  return undefined;
}

async function resolveSftpConnection(
  hostId?: string,
  context: ToolExecutionContext = {},
): Promise<{ connectionId?: string; hostId?: string; error?: string }> {
  if (context.isCancelled?.()) {
    return { error: "Error: the assistant run was stopped." };
  }
  let targetHostId = hostId;
  if (!targetHostId) {
    targetHostId = resolveTerminalTab()?.hostId || undefined;
    if (!targetHostId) {
      return {
        error:
          "Error: no host given and no current terminal to infer one from. Pass hostId (from list_hosts).",
      };
    }
  }

  const reused = reuseTabConnection(targetHostId);
  if (reused) return { connectionId: reused, hostId: targetHostId };

  bridgeAiSftp();
  const existing = aiConnByHost.get(targetHostId);
  if (existing && connStatus.get(existing) === "connected") {
    return { connectionId: existing, hostId: targetHostId };
  }

  try {
    await ipc.hosts.get(targetHostId);
  } catch {
    return { error: `Error: no saved host with id "${targetHostId}".` };
  }

  const id = existing ?? crypto.randomUUID();
  aiConnByHost.set(targetHostId, id);
  connStatus.set(id, "connecting");
  try {
    await ipc.sftp.connect(id, targetHostId);
  } catch (err) {
    aiConnByHost.delete(targetHostId);
    connStatus.delete(id);
    return {
      error: `Error: could not open an SFTP connection: ${errorMessage(err)}`,
    };
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (context.isCancelled?.()) {
      if (aiConnByHost.get(targetHostId) === id) {
        aiConnByHost.delete(targetHostId);
        connStatus.delete(id);
        void ipc.sftp.disconnect(id).catch(() => {});
      }
      return { error: "Error: the assistant run was stopped." };
    }
    const status = connStatus.get(id);
    if (status === "connected")
      return { connectionId: id, hostId: targetHostId };
    if (status === "error" || status === "closed") {
      aiConnByHost.delete(targetHostId);
      return {
        error:
          "Error: the SFTP connection failed or closed. Open a Files tab for this host to complete host-key trust or authentication, then retry.",
      };
    }
    await sleep(250);
  }
  return {
    error:
      "Error: timed out opening an SFTP connection. If the host needs host-key trust or a password, complete it in a Files tab and retry.",
  };
}

async function withConn(
  hostId: string | undefined,
  context: ToolExecutionContext,
  fn: (connectionId: string, hostId: string) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const resolved = await resolveSftpConnection(hostId, context);
  if (resolved.error || !resolved.connectionId || !resolved.hostId) {
    return toolFailure(resolved.error ?? "Error: no SFTP connection.");
  }
  if (context.isCancelled?.()) {
    return toolFailure("Error: the assistant run was stopped.");
  }
  try {
    return await fn(resolved.connectionId, resolved.hostId);
  } catch (err) {
    return toolFailure(`Error: ${errorMessage(err)}`);
  }
}

function prepareSftpTarget(args: Record<string, unknown>): PreparedCall {
  const requested = optionalStr(args, "hostId");
  if (requested) return { args: { ...args, hostId: requested } };
  const hostId = resolveTerminalTab()?.hostId || undefined;
  if (!hostId) {
    return {
      args,
      preflightError:
        "Error: no host given and no current terminal to infer one from. Pass hostId (from list_hosts).",
    };
  }
  return { args: { ...args, hostId } };
}

function refreshSftpViews(hostId: string, ...dirs: string[]): void {
  const targets = new Set(dirs);
  const state = useSftpStore.getState();
  for (const side of ["left", "right"] as const) {
    for (const tab of state.panes[side].tabs) {
      if (
        tab.kind === "remote" &&
        tab.hostId === hostId &&
        targets.has(tab.cwd)
      ) {
        void state.refresh(side, tab.id);
      }
    }
  }
}

type TransferEndpointInput = {
  kind: "local" | "sftp";
  path: string;
  hostId?: string;
};

type ResolvedTransferEndpoint = {
  endpoint: FsEndpoint;
  label: string;
};

function transferEndpointInput(
  args: Record<string, unknown>,
  key: "source" | "destination",
): TransferEndpointInput | string {
  const raw = args[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return `Error: ${key} must be an endpoint object.`;
  }
  const endpoint = raw as Record<string, unknown>;
  const kind = endpoint.kind;
  const path = optionalStr(endpoint, "path");
  if (kind !== "local" && kind !== "sftp") {
    return `Error: ${key}.kind must be "local" or "sftp".`;
  }
  if (!path) return `Error: ${key}.path is required.`;

  const hostId = optionalStr(endpoint, "hostId");
  if (kind === "sftp" && !hostId) {
    return `Error: ${key}.hostId is required for an SFTP endpoint. Use list_hosts to get a host id.`;
  }
  if (kind === "local" && hostId) {
    return `Error: ${key}.hostId is only valid for an SFTP endpoint.`;
  }
  if (kind === "local" && !isAbsoluteLocalPath(path)) {
    return `Error: ${key}.path must be an absolute local path.`;
  }
  return { kind, path, hostId };
}

function isAbsoluteLocalPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}

async function resolveTransferEndpoint(
  input: TransferEndpointInput,
  connections: Map<string, ReturnType<typeof resolveSftpConnection>>,
  context: ToolExecutionContext,
): Promise<ResolvedTransferEndpoint | string> {
  if (input.kind === "local") {
    return {
      endpoint: { connectionId: null, path: input.path },
      label: `local:${input.path}`,
    };
  }

  const hostId = input.hostId!;
  let pending = connections.get(hostId);
  if (!pending) {
    pending = Promise.resolve(resolveSftpConnection(hostId, context));
    connections.set(hostId, pending);
  }
  const resolved = await pending;
  if (resolved.error || !resolved.connectionId) {
    return resolved.error ?? `Error: no SFTP connection for host "${hostId}".`;
  }
  return {
    endpoint: { connectionId: resolved.connectionId, path: input.path },
    label: `sftp:${hostId}:${input.path}`,
  };
}

function refreshEndpointView(endpoint: FsEndpoint): void {
  const state = useSftpStore.getState();
  for (const side of ["left", "right"] as const) {
    for (const tab of state.panes[side].tabs) {
      if (
        tab.connectionId === endpoint.connectionId &&
        tab.cwd === endpoint.path
      ) {
        void state.refresh(side, tab.id);
      }
    }
  }
}

async function createTransferWaiter(
  transferId: string,
  context: ToolExecutionContext,
): Promise<{ completion: Promise<TransferEvent>; cleanup: () => void }> {
  let resolveCompletion!: (event: TransferEvent) => void;
  const completion = new Promise<TransferEvent>((resolve) => {
    resolveCompletion = resolve;
  });
  const unlisten = await ipc.sftp.onTransfer((candidate) => {
    if (candidate.transferId !== transferId || candidate.status === "active") {
      return;
    }
    resolveCompletion(candidate);
  });
  let cancelRequested = false;
  const interval = globalThis.setInterval(() => {
    if (!cancelRequested && context.isCancelled?.()) {
      cancelRequested = true;
      void ipc.sftp.cancelTransfer(transferId);
    }
  }, 200);
  return {
    completion,
    cleanup: () => {
      globalThis.clearInterval(interval);
      unlisten();
    },
  };
}

async function transferFile(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const source = transferEndpointInput(args, "source");
  if (typeof source === "string") return toolFailure(source);
  const destination = transferEndpointInput(args, "destination");
  if (typeof destination === "string") return toolFailure(destination);
  if (source.kind === "local" && destination.kind === "local") {
    return toolFailure(
      "Error: transfer_file requires at least one SFTP endpoint; use local filesystem tools for local-only operations.",
    );
  }

  const connections = new Map<
    string,
    ReturnType<typeof resolveSftpConnection>
  >();
  const resolvedSource = await resolveTransferEndpoint(
    source,
    connections,
    context,
  );
  if (typeof resolvedSource === "string") return toolFailure(resolvedSource);
  const resolvedDestination = await resolveTransferEndpoint(
    destination,
    connections,
    context,
  );
  if (typeof resolvedDestination === "string") {
    return toolFailure(resolvedDestination);
  }

  const transferId = crypto.randomUUID();
  let waiter:
    { completion: Promise<TransferEvent>; cleanup: () => void } | undefined;
  try {
    // Register before starting so a fast completion event cannot be missed.
    waiter = await createTransferWaiter(transferId, context);
    await ipc.sftp.transfer(
      transferId,
      resolvedSource.endpoint,
      resolvedDestination.endpoint,
      bool(args, "compress"),
    );
    const event = await waiter.completion;
    if (event.status === "done") {
      refreshEndpointView(resolvedDestination.endpoint);
      return toolSuccess(
        `Transferred ${resolvedSource.label} to directory ${resolvedDestination.label}. transferId: ${transferId}`,
      );
    }
    if (event.status === "cancelled") {
      return toolFailure(`Error: transfer ${transferId} was cancelled.`);
    }
    return toolFailure(
      `Error: transfer ${transferId} failed${event.message ? `: ${event.message}` : "."}`,
    );
  } catch (err) {
    return toolFailure(`Error: ${errorMessage(err)}`);
  } finally {
    waiter?.cleanup();
  }
}

async function listFiles(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  return withConn(optionalStr(args, "hostId"), context, async (conn) => {
    const path = optionalStr(args, "path") ?? (await ipc.sftp.home(conn));
    const entries = await ipc.sftp.list(conn, path);
    return toolSuccess(
      JSON.stringify({
        path,
        entries: entries.map((e) => ({
          name: e.name,
          kind: e.kind,
          size: e.size,
          symlink: e.isSymlink || undefined,
        })),
      }),
    );
  });
}

async function readFile(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), context, async (conn) => {
    const text = await ipc.sftp.readText(conn, path);
    return toolSuccess(text || "(the file is empty)");
  });
}

async function writeFile(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  const content = str(args, "content");
  return withConn(optionalStr(args, "hostId"), context, async (conn, host) => {
    await ipc.sftp.writeText(conn, path, content);
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Wrote ${content.length} characters to ${path}.`);
  });
}

async function makeDirectory(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), context, async (conn, host) => {
    await ipc.sftp.mkdir(conn, path);
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Created directory ${path}.`);
  });
}

async function movePath(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const from = optionalStr(args, "from");
  const to = optionalStr(args, "to");
  if (!from || !to) return toolFailure("Error: from and to are required.");
  return withConn(optionalStr(args, "hostId"), context, async (conn, host) => {
    await ipc.sftp.rename(conn, from, to);
    refreshSftpViews(host, parentPath(from), parentPath(to));
    return toolSuccess(`Moved ${from} to ${to}.`);
  });
}

async function deleteFile(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), context, async (conn, host) => {
    await ipc.sftp.remove(conn, path, bool(args, "isDir"));
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Deleted ${path}.`);
  });
}

async function chmodPath(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  const octal = optionalStr(args, "mode");
  const mode = octal ? octalToMode(octal) : null;
  if (mode === null) {
    return toolFailure('Error: mode must be octal permissions like "644".');
  }
  return withConn(optionalStr(args, "hostId"), context, async (conn, host) => {
    await ipc.sftp.chmod(conn, path, mode);
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Set ${path} to ${octal}.`);
  });
}

const HOST_ARG = {
  hostId: {
    type: "string",
    description:
      "Host id from list_hosts. Omit to use the current terminal's host.",
  },
} as const;

export const fileTools: AiTool[] = [
  {
    spec: {
      name: "transfer_file",
      description:
        "Transfer a file or directory between the local computer and an SFTP host, or between two SFTP hosts. The destination path must be an existing directory. Use absolute paths for local endpoints. Set compress for directories with many small files.",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "object",
            description: "File or directory to transfer.",
            properties: {
              kind: { type: "string", enum: ["local", "sftp"] },
              path: { type: "string", description: "Source path." },
              hostId: {
                type: "string",
                description:
                  "Required when kind is sftp. Host id from list_hosts.",
              },
            },
            required: ["kind", "path"],
            additionalProperties: false,
          },
          destination: {
            type: "object",
            description:
              "Existing directory that will receive the source basename.",
            properties: {
              kind: { type: "string", enum: ["local", "sftp"] },
              path: {
                type: "string",
                description: "Existing destination directory path.",
              },
              hostId: {
                type: "string",
                description:
                  "Required when kind is sftp. Host id from list_hosts.",
              },
            },
            required: ["kind", "path"],
            additionalProperties: false,
          },
          compress: {
            type: "boolean",
            description:
              "Compress directory transfers in transit; useful for many small files. Defaults to false.",
          },
        },
        required: ["source", "destination"],
        additionalProperties: false,
      },
    },
    icon: ArrowRightLeft,
    labelKey: "ai.tool.transferFile",
    confirmKey: "ai.confirmTransfer",
    requiresApproval: true,
    execute: async (args, context) => transferFile(args, context),
  },
  {
    spec: {
      name: "list_files",
      description:
        "List directory entries over SFTP on a host. Omit path to list the home directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path." },
          ...HOST_ARG,
        },
        additionalProperties: false,
      },
    },
    icon: Folder,
    labelKey: "ai.tool.listFiles",
    prepare: prepareSftpTarget,
    execute: listFiles,
  },
  {
    spec: {
      name: "read_file",
      description:
        "Read a text file over SFTP. Prefer this over cat for reading config files. Large files are truncated in the middle.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path." },
          ...HOST_ARG,
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    icon: FileText,
    labelKey: "ai.tool.readFile",
    prepare: prepareSftpTarget,
    execute: readFile,
  },
  {
    spec: {
      name: "write_file",
      description:
        "Write (create or overwrite) a text file over SFTP with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path." },
          content: { type: "string", description: "Full file contents." },
          ...HOST_ARG,
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.writeFile",
    requiresApproval: true,
    prepare: prepareSftpTarget,
    execute: writeFile,
  },
  {
    spec: {
      name: "make_directory",
      description: "Create a directory over SFTP.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to create." },
          ...HOST_ARG,
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    icon: FolderPlus,
    labelKey: "ai.tool.makeDirectory",
    requiresApproval: true,
    prepare: prepareSftpTarget,
    execute: makeDirectory,
  },
  {
    spec: {
      name: "move_path",
      description: "Move or rename a file or directory over SFTP.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Current path." },
          to: { type: "string", description: "New path." },
          ...HOST_ARG,
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
    },
    icon: FolderInput,
    labelKey: "ai.tool.movePath",
    requiresApproval: true,
    prepare: prepareSftpTarget,
    execute: movePath,
  },
  {
    spec: {
      name: "delete_file",
      description:
        "Delete a file or directory over SFTP. Set isDir true for directories.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to delete." },
          isDir: {
            type: "boolean",
            description: "True if the path is a directory.",
          },
          ...HOST_ARG,
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteFile",
    requiresApproval: true,
    prepare: prepareSftpTarget,
    execute: deleteFile,
  },
  {
    spec: {
      name: "chmod_path",
      description: "Change permissions of a path over SFTP.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to change." },
          mode: {
            type: "string",
            description: 'Octal permissions like "644" or "755".',
          },
          ...HOST_ARG,
        },
        required: ["path", "mode"],
        additionalProperties: false,
      },
    },
    icon: KeyRound,
    labelKey: "ai.tool.chmodPath",
    requiresApproval: true,
    prepare: prepareSftpTarget,
    execute: chmodPath,
  },
];
