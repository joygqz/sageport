import {
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
import { resolveTerminalTab, sleep } from "./terminal";
import {
  bool,
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
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
): Promise<{ connectionId?: string; hostId?: string; error?: string }> {
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
  fn: (connectionId: string, hostId: string) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const resolved = await resolveSftpConnection(hostId);
  if (resolved.error || !resolved.connectionId || !resolved.hostId) {
    return toolFailure(resolved.error ?? "Error: no SFTP connection.");
  }
  try {
    return await fn(resolved.connectionId, resolved.hostId);
  } catch (err) {
    return toolFailure(`Error: ${errorMessage(err)}`);
  }
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

async function listFiles(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  return withConn(optionalStr(args, "hostId"), async (conn) => {
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
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), async (conn) => {
    const text = await ipc.sftp.readText(conn, path);
    return toolSuccess(text || "(the file is empty)");
  });
}

async function writeFile(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  const content = str(args, "content");
  return withConn(optionalStr(args, "hostId"), async (conn, host) => {
    await ipc.sftp.writeText(conn, path, content);
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Wrote ${content.length} characters to ${path}.`);
  });
}

async function makeDirectory(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), async (conn, host) => {
    await ipc.sftp.mkdir(conn, path);
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Created directory ${path}.`);
  });
}

async function movePath(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const from = optionalStr(args, "from");
  const to = optionalStr(args, "to");
  if (!from || !to) return toolFailure("Error: from and to are required.");
  return withConn(optionalStr(args, "hostId"), async (conn, host) => {
    await ipc.sftp.rename(conn, from, to);
    refreshSftpViews(host, parentPath(from), parentPath(to));
    return toolSuccess(`Moved ${from} to ${to}.`);
  });
}

async function deleteFile(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  return withConn(optionalStr(args, "hostId"), async (conn, host) => {
    await ipc.sftp.remove(conn, path, bool(args, "isDir"));
    refreshSftpViews(host, parentPath(path));
    return toolSuccess(`Deleted ${path}.`);
  });
}

async function chmodPath(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: no path given.");
  const octal = optionalStr(args, "mode");
  const mode = octal ? octalToMode(octal) : null;
  if (mode === null) {
    return toolFailure('Error: mode must be octal permissions like "644".');
  }
  return withConn(optionalStr(args, "hostId"), async (conn, host) => {
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
    execute: async (args) => listFiles(args),
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
    execute: async (args) => readFile(args),
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
    execute: async (args) => writeFile(args),
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
    execute: async (args) => makeDirectory(args),
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
    execute: async (args) => movePath(args),
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
    execute: async (args) => deleteFile(args),
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
    execute: async (args) => chmodPath(args),
  },
];
