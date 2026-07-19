import {
  Key,
  KeyRound,
  SquarePen,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import { ipc } from "@/lib/ipc";
import type {
  AuthType,
  Identity,
  IdentityInput,
  SshKey,
  SshKeyAlgorithm,
  SshKeyInput,
} from "@/types/models";
import { invalidateIdentities, invalidateSshKeys } from "./cache";
import {
  optionalStr,
  nullableStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionResult,
} from "./types";

const ALGORITHMS: SshKeyAlgorithm[] = [
  "ed25519",
  "ecdsaP256",
  "ecdsaP384",
  "ecdsaP521",
  "rsa2048",
  "rsa4096",
];

async function findIdentity(id: string): Promise<Identity | undefined> {
  const identities = await ipc.identities.list();
  return identities.find((i) => i.id === id);
}

async function listIdentities(): Promise<ToolExecutionResult> {
  const identities = await ipc.identities.list();
  if (identities.length === 0) return toolSuccess("No saved identities yet.");
  return toolSuccess(
    JSON.stringify(
      identities.map((i) => ({
        id: i.id,
        name: i.name,
        username: i.username,
        authType: i.authType,
        keyId: i.keyId ?? undefined,
      })),
    ),
  );
}

function identityInput(
  args: Record<string, unknown>,
  base?: Identity,
): IdentityInput {
  const keyId = nullableStr(args, "keyId");
  const password = nullableStr(args, "password");
  return {
    name: optionalStr(args, "name") ?? base?.name ?? "",
    username: optionalStr(args, "username") ?? base?.username ?? "",
    authType: (optionalStr(args, "authType") ??
      base?.authType ??
      "password") as AuthType,
    keyId: keyId === undefined ? (base?.keyId ?? null) : keyId,
    password: password === undefined ? undefined : (password ?? ""),
  };
}

async function createIdentity(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalStr(args, "name");
  const username = optionalStr(args, "username");
  if (!name || !username) {
    return toolFailure("Error: name and username are required.");
  }
  const identity = await ipc.identities.create(identityInput(args));
  invalidateIdentities();
  return toolSuccess(`Created identity "${identity.name}". id: ${identity.id}`);
}

async function updateIdentity(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no identity id given.");
  const current = await findIdentity(id);
  if (!current) return toolFailure(`Error: no identity with id "${id}".`);
  const identity = await ipc.identities.update(
    id,
    identityInput(args, current),
  );
  invalidateIdentities();
  return toolSuccess(`Updated identity "${identity.name}".`);
}

async function revealIdentityPassword(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no identity id given.");
  const password = await ipc.identities.revealPassword(id);
  return toolSuccess(JSON.stringify({ id, password }));
}

async function deleteIdentity(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no identity id given.");
  try {
    await ipc.identities.remove(id);
  } catch {
    return toolFailure(`Error: could not delete identity "${id}".`);
  }
  invalidateIdentities();
  return toolSuccess(`Deleted identity ${id}.`);
}

async function listSshKeys(): Promise<ToolExecutionResult> {
  const keys = await ipc.keys.list();
  if (keys.length === 0) return toolSuccess("No SSH keys saved yet.");
  return toolSuccess(
    JSON.stringify(
      keys.map((k) => ({
        id: k.id,
        name: k.name,
        publicKey: k.publicKey ?? undefined,
        hasPrivateKey: k.hasPrivateKey,
        hasPassphrase: k.hasPassphrase,
      })),
    ),
  );
}

async function findSshKey(id: string): Promise<SshKey | undefined> {
  const keys = await ipc.keys.list();
  return keys.find((key) => key.id === id);
}

function sshKeyInput(
  args: Record<string, unknown>,
  base?: SshKey,
): SshKeyInput {
  const publicKey = nullableStr(args, "publicKey");
  const privateKey = nullableStr(args, "privateKey");
  const passphrase = nullableStr(args, "passphrase");
  return {
    name: optionalStr(args, "name") ?? base?.name ?? "",
    publicKey: publicKey === undefined ? undefined : publicKey,
    privateKey: privateKey === undefined ? undefined : privateKey,
    passphrase: passphrase === undefined ? undefined : passphrase,
  };
}

async function createSshKey(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  if (!optionalStr(args, "name") || !optionalStr(args, "privateKey")) {
    return toolFailure("Error: name and privateKey are required.");
  }
  const key = await ipc.keys.create(sshKeyInput(args));
  invalidateSshKeys();
  return toolSuccess(`Created SSH key "${key.name}". id: ${key.id}`);
}

async function updateSshKey(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no key id given.");
  const current = await findSshKey(id);
  if (!current) return toolFailure(`Error: no key with id "${id}".`);
  const key = await ipc.keys.update(id, sshKeyInput(args, current));
  invalidateSshKeys();
  return toolSuccess(`Updated SSH key "${key.name}".`);
}

async function importSshKeyFile(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  if (!path) return toolFailure("Error: a key file path is required.");
  const file = await ipc.keys.importFile(path);
  const key = await ipc.keys.create({
    name: optionalStr(args, "name") ?? file.name,
    privateKey: file.privateKey,
    publicKey: file.publicKey,
    passphrase: optionalStr(args, "passphrase") ?? null,
  });
  invalidateSshKeys();
  return toolSuccess(`Imported SSH key "${key.name}". id: ${key.id}`);
}

async function generateSshKey(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalStr(args, "name");
  const algorithm = optionalStr(args, "algorithm") as
    SshKeyAlgorithm | undefined;
  if (!name) return toolFailure("Error: a key name is required.");
  if (!algorithm || !ALGORITHMS.includes(algorithm)) {
    return toolFailure(
      `Error: algorithm must be one of ${ALGORITHMS.join(", ")}.`,
    );
  }
  const key = await ipc.keys.generate({
    name,
    algorithm,
    passphrase: optionalStr(args, "passphrase") ?? null,
  });
  invalidateSshKeys();
  return toolSuccess(
    JSON.stringify({
      id: key.id,
      name: key.name,
      algorithm: key.algorithm,
      fingerprint: key.fingerprint,
      publicKey: key.publicKey ?? undefined,
    }),
  );
}

async function deleteSshKey(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no key id given.");
  try {
    await ipc.keys.remove(id);
  } catch {
    return toolFailure(`Error: could not delete key "${id}".`);
  }
  invalidateSshKeys();
  return toolSuccess(`Deleted key ${id}.`);
}

export const credentialTools: AiTool[] = [
  {
    spec: {
      name: "list_identities",
      description:
        "List saved identities (a username plus an auth method that hosts can share). Secrets are never returned.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Users,
    labelKey: "ai.tool.listIdentities",
    execute: async () => listIdentities(),
  },
  {
    spec: {
      name: "create_identity",
      description: "Create a reusable login identity.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Identity name." },
          username: { type: "string", description: "Login user." },
          authType: {
            type: "string",
            enum: ["password", "key", "agent"],
            description: "Authentication method.",
          },
          keyId: {
            type: "string",
            description:
              "SSH key id (from list_ssh_keys) when authType is key.",
          },
          password: {
            type: "string",
            description: "Password when authType is password.",
          },
        },
        required: ["name", "username"],
        additionalProperties: false,
      },
    },
    icon: UserPlus,
    labelKey: "ai.tool.createIdentity",
    requiresApproval: true,
    execute: async (args) => createIdentity(args),
  },
  {
    spec: {
      name: "update_identity",
      description:
        "Update a saved identity. Only the given fields change; others are kept.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Identity id." },
          name: { type: "string" },
          username: { type: "string" },
          authType: { type: "string", enum: ["password", "key", "agent"] },
          keyId: {
            type: ["string", "null"],
            description: "Set null to clear the key association.",
          },
          password: {
            type: ["string", "null"],
            description: "Set null to clear the saved password.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateIdentity",
    requiresApproval: true,
    execute: async (args) => updateIdentity(args),
  },
  {
    spec: {
      name: "reveal_identity_password",
      description:
        "Reveal a saved identity password. The result is sensitive and is not retained in chat history.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Identity id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: KeyRound,
    labelKey: "ai.tool.revealIdentityPassword",
    requiresApproval: true,
    alwaysRequireApproval: true,
    sensitiveResult: true,
    execute: async (args) => revealIdentityPassword(args),
  },
  {
    spec: {
      name: "delete_identity",
      description: "Delete a saved identity by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Identity id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteIdentity",
    requiresApproval: true,
    execute: async (args) => deleteIdentity(args),
  },
  {
    spec: {
      name: "list_ssh_keys",
      description:
        "List saved SSH keys by name and public key. Private keys are never returned.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Key,
    labelKey: "ai.tool.listSshKeys",
    execute: async () => listSshKeys(),
  },
  {
    spec: {
      name: "generate_ssh_key",
      description:
        "Generate a new SSH key pair and save it. Returns the public key and fingerprint; the private key stays in the app.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Key name." },
          algorithm: {
            type: "string",
            enum: ALGORITHMS,
            description: "Key algorithm.",
          },
          passphrase: {
            type: "string",
            description: "Optional passphrase to protect the private key.",
          },
        },
        required: ["name", "algorithm"],
        additionalProperties: false,
      },
    },
    icon: KeyRound,
    labelKey: "ai.tool.generateSshKey",
    requiresApproval: true,
    execute: async (args) => generateSshKey(args),
  },
  {
    spec: {
      name: "create_ssh_key",
      description:
        "Save existing SSH private key material. Use import_ssh_key_file when the key is already in a local file.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Key name." },
          privateKey: { type: "string", description: "Private key text." },
          publicKey: {
            type: ["string", "null"],
            description: "Optional public key text.",
          },
          passphrase: {
            type: ["string", "null"],
            description: "Passphrase for encrypted private key material.",
          },
        },
        required: ["name", "privateKey"],
        additionalProperties: false,
      },
    },
    icon: KeyRound,
    labelKey: "ai.tool.createSshKey",
    requiresApproval: true,
    execute: async (args) => createSshKey(args),
  },
  {
    spec: {
      name: "import_ssh_key_file",
      description: "Import and save an SSH private key from a local file path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute local key path." },
          name: { type: "string", description: "Optional saved key name." },
          passphrase: {
            type: "string",
            description: "Passphrase when the private key is encrypted.",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    icon: KeyRound,
    labelKey: "ai.tool.importSshKeyFile",
    requiresApproval: true,
    execute: async (args) => importSshKeyFile(args),
  },
  {
    spec: {
      name: "update_ssh_key",
      description:
        "Rename a saved SSH key or replace its key material. Only the given fields change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "SSH key id." },
          name: { type: "string", description: "New key name." },
          privateKey: {
            type: ["string", "null"],
            description: "Replacement private key text.",
          },
          publicKey: {
            type: ["string", "null"],
            description: "Replacement public key text.",
          },
          passphrase: {
            type: ["string", "null"],
            description: "Replacement key passphrase. Set null to clear it.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateSshKey",
    requiresApproval: true,
    execute: async (args) => updateSshKey(args),
  },
  {
    spec: {
      name: "delete_ssh_key",
      description: "Delete a saved SSH key by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Key id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteSshKey",
    requiresApproval: true,
    execute: async (args) => deleteSshKey(args),
  },
];
