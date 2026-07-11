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
  SshKeyAlgorithm,
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
    password: password === undefined ? (base?.password ?? null) : password,
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
        hasPrivateKey: Boolean(k.privateKey),
      })),
    ),
  );
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
