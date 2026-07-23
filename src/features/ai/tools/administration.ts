import { Cloud, RefreshCw, Settings } from "lucide-react";

import {
  autostartQueryKey,
  readAutostart,
  writeAutostart,
} from "@/features/settings/autostart";
import {
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  publishLocale,
} from "@/i18n/config";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";
import {
  publishThemePreference,
  readStoredThemePreference,
  serializeThemePreference,
} from "@/themes/apply";
import { getThemeFamily, THEME_FAMILIES } from "@/themes/themes";
import type { ThemeMode } from "@/themes/types";
import type {
  AiProtocol,
  SyncOAuthEvent,
  SyncProviderKind,
  SyncProviderSettings,
} from "@/types/models";
import { getAiToolCatalog } from "./catalog";
import {
  bool,
  nullableNum,
  num,
  optionalStr,
  str,
  strArray,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionResult,
} from "./types";

type OAuthProgress =
  | { status: "idle" }
  | { status: "pending"; provider: SyncProviderKind }
  | ({ status: "actionRequired"; provider: SyncProviderKind } & SyncOAuthEvent)
  | { status: "authorized"; provider: SyncProviderKind; account: string }
  | { status: "error"; provider: SyncProviderKind; message: string };

let oauthProgress: OAuthProgress = { status: "idle" };

async function getApplicationSettings(): Promise<ToolExecutionResult> {
  const [autostart, ai, { useFontStore }, { useZoomStore }] = await Promise.all(
    [
      readAutostart(),
      ipc.ai.getConfig(),
      import("@/workbench/font"),
      import("@/workbench/zoom"),
    ],
  );
  return toolSuccess(
    JSON.stringify({
      autostart,
      locale: detectLocale(),
      theme: readStoredThemePreference(),
      fontFamily: useFontStore.getState().family,
      zoomLevel: useZoomStore.getState().level,
      themeFamilies: THEME_FAMILIES.map(({ id, name }) => ({ id, name })),
      ai: {
        ...ai,
        availableTools: getAiToolCatalog(),
      },
    }),
  );
}

async function updateApplicationSettings(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const localeValue = optionalStr(args, "locale");
  if (localeValue && !isLocale(localeValue)) {
    return toolFailure(`Error: unsupported locale "${localeValue}".`);
  }
  const locale = isLocale(localeValue) ? localeValue : undefined;
  const familyId = optionalStr(args, "themeFamily");
  const mode = optionalStr(args, "themeMode") as ThemeMode | undefined;
  if (familyId && getThemeFamily(familyId).id !== familyId) {
    return toolFailure(`Error: unsupported theme family "${familyId}".`);
  }
  if (mode && !["system", "light", "dark"].includes(mode)) {
    return toolFailure(`Error: unsupported theme mode "${mode}".`);
  }

  const [{ useFontStore }, { useZoomStore }] = await Promise.all([
    import("@/workbench/font"),
    import("@/workbench/zoom"),
  ]);
  let autostartApplied = true;
  if ("autostart" in args) {
    const requested = bool(args, "autostart");
    const actual = await writeAutostart(requested);
    queryClient.setQueryData(autostartQueryKey, actual);
    autostartApplied = actual === requested;
  }
  if (locale) {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    await ipc.settings.set("general.locale", locale);
    publishLocale(locale);
  }

  if (familyId || mode) {
    const current = readStoredThemePreference();
    const nextFamily = familyId ?? current.familyId;
    const preference = { familyId: nextFamily, mode: mode ?? current.mode };
    const serialized = serializeThemePreference(preference);
    localStorage.setItem("sageport.theme", serialized);
    await ipc.settings.set("general.theme", serialized);
    publishThemePreference(preference);
  }

  if ("fontFamily" in args) {
    const family = str(args, "fontFamily");
    useFontStore.getState().setFamily(family);
    await ipc.settings.set("general.fontFamily", family);
  }
  if ("zoomLevel" in args) {
    const level = num(args, "zoomLevel") ?? 0;
    useZoomStore.getState().setLevel(level);
    await ipc.settings.set(
      "general.zoomLevel",
      String(useZoomStore.getState().level),
    );
  }
  void queryClient.invalidateQueries({ queryKey: ["settings"] });
  if (!autostartApplied) {
    return toolFailure(
      "Error: the system did not apply the requested launch-at-login setting. Other requested settings were updated.",
    );
  }
  return toolSuccess("Updated application settings.");
}

async function updateAiSettings(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const current = await ipc.ai.getConfig();
  const maxHistoryTokens = nullableNum(args, "maxHistoryTokens");
  await ipc.ai.setConfig({
    baseUrl: "baseUrl" in args ? str(args, "baseUrl") : current.baseUrl,
    protocol:
      (optionalStr(args, "protocol") as AiProtocol | undefined) ??
      current.protocol,
    apiKey: "apiKey" in args ? str(args, "apiKey") : undefined,
    autoApprove:
      "autoApprove" in args ? bool(args, "autoApprove") : current.autoApprove,
    enabledTools:
      "enabledTools" in args ? strArray(args, "enabledTools") : undefined,
    maxHistoryTokens:
      maxHistoryTokens === undefined
        ? current.maxHistoryTokens
        : maxHistoryTokens,
  });
  if ("model" in args) await ipc.ai.setModel(str(args, "model"));
  void queryClient.invalidateQueries({ queryKey: ["ai", "config"] });
  return toolSuccess("Updated AI settings.");
}

async function listAiModels(): Promise<ToolExecutionResult> {
  return toolSuccess(JSON.stringify(await ipc.ai.listModels()));
}

async function getAiModelLimits(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const model = optionalStr(args, "model");
  if (!model) return toolFailure("Error: model is required.");
  return toolSuccess(JSON.stringify(await ipc.ai.modelLimits(model)));
}

async function startSyncOAuth(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const provider = optionalStr(args, "provider") as
    SyncProviderKind | undefined;
  if (!provider || !["gist", "gdrive", "onedrive"].includes(provider)) {
    return toolFailure("Error: provider must be gist, gdrive, or onedrive.");
  }
  await ipc.sync.oauthCancel().catch(() => undefined);
  oauthProgress = { status: "pending", provider };
  let resolveFirst!: () => void;
  const firstEvent = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  void ipc.sync
    .oauthStart(provider, (event) => {
      oauthProgress = { status: "actionRequired", provider, ...event };
      resolveFirst();
    })
    .then(({ account }) => {
      oauthProgress = { status: "authorized", provider, account };
      resolveFirst();
    })
    .catch((error) => {
      oauthProgress = { status: "error", provider, message: String(error) };
      resolveFirst();
    });
  await firstEvent;
  return toolSuccess(JSON.stringify(oauthProgress));
}

async function cancelSyncOAuth(): Promise<ToolExecutionResult> {
  await ipc.sync.oauthCancel();
  oauthProgress = { status: "idle" };
  return toolSuccess("Canceled sync authorization.");
}

function syncSettings(
  provider: SyncProviderKind,
  raw: unknown,
): SyncProviderSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const settings = raw as Record<string, unknown>;
  if (provider === "webdav") {
    return {
      url: str(settings, "url"),
      username: str(settings, "username"),
      password: str(settings, "password"),
    };
  }
  if (provider === "s3") {
    return {
      endpoint: str(settings, "endpoint"),
      region: str(settings, "region"),
      bucket: str(settings, "bucket"),
      prefix: str(settings, "prefix"),
      accessKey: str(settings, "accessKey"),
      secretKey: str(settings, "secretKey"),
      pathStyle: bool(settings, "pathStyle"),
    };
  }
  return undefined;
}

async function connectSync(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const provider = optionalStr(args, "provider") as
    SyncProviderKind | undefined;
  const passphrase = optionalStr(args, "passphrase");
  if (!provider || !passphrase) {
    return toolFailure("Error: provider and passphrase are required.");
  }
  const outcome = await ipc.sync.connect({
    provider,
    settings: syncSettings(provider, args.settings),
    passphrase,
    force: bool(args, "force"),
  });
  void queryClient.invalidateQueries({ queryKey: ["sync"] });
  return toolSuccess(JSON.stringify(outcome));
}

async function disconnectSync(): Promise<ToolExecutionResult> {
  await ipc.sync.disconnect();
  void queryClient.invalidateQueries({ queryKey: ["sync"] });
  return toolSuccess("Disconnected sync.");
}

async function pushSync(): Promise<ToolExecutionResult> {
  const outcome = await ipc.sync.push();
  void queryClient.invalidateQueries({ queryKey: ["sync"] });
  return toolSuccess(JSON.stringify(outcome));
}

async function restoreSyncVersion(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no sync version id given.");
  const outcome = await ipc.sync.restoreVersion(id);
  void queryClient.invalidateQueries();
  return toolSuccess(JSON.stringify(outcome));
}

async function exportSyncFile(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  const passphrase = optionalStr(args, "passphrase");
  if (!path || !passphrase)
    return toolFailure("Error: path and passphrase are required.");
  await ipc.sync.fileExport(path, passphrase);
  return toolSuccess(`Exported encrypted backup to ${path}.`);
}

async function importSyncFile(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const path = optionalStr(args, "path");
  const passphrase = optionalStr(args, "passphrase");
  if (!path || !passphrase)
    return toolFailure("Error: path and passphrase are required.");
  await ipc.sync.fileImport(path, passphrase);
  void queryClient.invalidateQueries();
  return toolSuccess(`Imported encrypted backup from ${path}.`);
}

async function checkForUpdates(): Promise<ToolExecutionResult> {
  return toolSuccess(JSON.stringify(await ipc.update.check()));
}

async function installUpdate(): Promise<ToolExecutionResult> {
  return toolSuccess(JSON.stringify(await ipc.update.install()));
}

const EMPTY_PARAMETERS = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

const SYNC_SETTINGS_SCHEMA = {
  type: "object" as const,
  properties: {
    url: { type: "string" },
    username: { type: "string" },
    password: { type: "string" },
    endpoint: { type: "string" },
    region: { type: "string" },
    bucket: { type: "string" },
    prefix: { type: "string" },
    accessKey: { type: "string" },
    secretKey: { type: "string" },
    pathStyle: { type: "boolean" },
  },
  additionalProperties: false,
};

export const administrationTools: AiTool[] = [
  {
    spec: {
      name: "get_application_settings",
      description:
        "Get general application and AI settings. Secrets are not returned.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Settings,
    labelKey: "ai.tool.getApplicationSettings",
    execute: async () => getApplicationSettings(),
  },
  {
    spec: {
      name: "update_application_settings",
      description:
        "Update appearance, locale, zoom, font, or launch-at-login settings.",
      parameters: {
        type: "object",
        properties: {
          autostart: { type: "boolean" },
          locale: { type: "string", enum: ["en", "zh-CN"] },
          themeFamily: {
            type: "string",
            enum: THEME_FAMILIES.map((family) => family.id),
          },
          themeMode: { type: "string", enum: ["system", "light", "dark"] },
          fontFamily: { type: "string" },
          zoomLevel: { type: "integer", minimum: -3, maximum: 5 },
        },
        additionalProperties: false,
      },
    },
    icon: Settings,
    labelKey: "ai.tool.updateApplicationSettings",
    requiresApproval: true,
    execute: async (args) => updateApplicationSettings(args),
  },
  {
    spec: {
      name: "list_ai_models",
      description: "List models available from the configured AI endpoint.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Settings,
    labelKey: "ai.tool.listAiModels",
    execute: async () => listAiModels(),
  },
  {
    spec: {
      name: "get_ai_model_limits",
      description: "Get context and output token limits for an AI model.",
      parameters: {
        type: "object",
        properties: { model: { type: "string" } },
        required: ["model"],
        additionalProperties: false,
      },
    },
    icon: Settings,
    labelKey: "ai.tool.getAiModelLimits",
    execute: async (args) => getAiModelLimits(args),
  },
  {
    spec: {
      name: "update_ai_settings",
      description:
        "Update the assistant provider, model, permissions, or context settings.",
      parameters: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
          protocol: { type: "string", enum: ["openai", "anthropic"] },
          apiKey: { type: "string" },
          model: { type: "string" },
          autoApprove: { type: "boolean" },
          enabledTools: { type: "array", items: { type: "string" } },
          maxHistoryTokens: { type: ["integer", "null"], minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    icon: Settings,
    labelKey: "ai.tool.updateAiSettings",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => updateAiSettings(args),
  },
  {
    spec: {
      name: "get_sync_status",
      description:
        "Get sync provider, account, health, and authorization availability.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.getSyncStatus",
    execute: async () => toolSuccess(JSON.stringify(await ipc.sync.status())),
  },
  {
    spec: {
      name: "start_sync_authorization",
      description:
        "Start OAuth authorization for GitHub Gist, Google Drive, or OneDrive.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["gist", "gdrive", "onedrive"] },
        },
        required: ["provider"],
        additionalProperties: false,
      },
    },
    icon: Cloud,
    labelKey: "ai.tool.startSyncAuthorization",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => startSyncOAuth(args),
  },
  {
    spec: {
      name: "get_sync_authorization_status",
      description: "Get the current sync authorization progress.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.getSyncAuthorizationStatus",
    execute: async () => toolSuccess(JSON.stringify(oauthProgress)),
  },
  {
    spec: {
      name: "cancel_sync_authorization",
      description: "Cancel the current sync authorization flow.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.cancelSyncAuthorization",
    requiresApproval: true,
    execute: async () => cancelSyncOAuth(),
  },
  {
    spec: {
      name: "connect_sync",
      description:
        "Connect a sync provider using an authorized account or explicit WebDAV or S3 settings.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["gist", "gdrive", "onedrive", "webdav", "s3"],
          },
          passphrase: { type: "string" },
          settings: SYNC_SETTINGS_SCHEMA,
          force: { type: "boolean" },
        },
        required: ["provider", "passphrase"],
        additionalProperties: false,
      },
    },
    icon: Cloud,
    labelKey: "ai.tool.connectSync",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => connectSync(args),
  },
  {
    spec: {
      name: "disconnect_sync",
      description: "Disconnect the current sync provider.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.disconnectSync",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async () => disconnectSync(),
  },
  {
    spec: {
      name: "push_sync",
      description: "Push local data to the connected sync provider.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.pushSync",
    requiresApproval: true,
    execute: async () => pushSync(),
  },
  {
    spec: {
      name: "list_sync_versions",
      description: "List available remote backup versions.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: Cloud,
    labelKey: "ai.tool.listSyncVersions",
    execute: async () =>
      toolSuccess(JSON.stringify(await ipc.sync.listVersions())),
  },
  {
    spec: {
      name: "restore_sync_version",
      description: "Restore application data from a remote sync version.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Cloud,
    labelKey: "ai.tool.restoreSyncVersion",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => restoreSyncVersion(args),
  },
  {
    spec: {
      name: "export_sync_backup",
      description: "Export an encrypted backup to a local path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          passphrase: { type: "string" },
        },
        required: ["path", "passphrase"],
        additionalProperties: false,
      },
    },
    icon: Cloud,
    labelKey: "ai.tool.exportSyncBackup",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => exportSyncFile(args),
  },
  {
    spec: {
      name: "import_sync_backup",
      description: "Import application data from an encrypted local backup.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          passphrase: { type: "string" },
        },
        required: ["path", "passphrase"],
        additionalProperties: false,
      },
    },
    icon: Cloud,
    labelKey: "ai.tool.importSyncBackup",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async (args) => importSyncFile(args),
  },
  {
    spec: {
      name: "get_update_status",
      description: "Get application update status and installation capability.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: RefreshCw,
    labelKey: "ai.tool.getUpdateStatus",
    execute: async () =>
      toolSuccess(
        JSON.stringify({
          status: await ipc.update.status(),
          canInstall: await ipc.update.canSelfUpdate(),
        }),
      ),
  },
  {
    spec: {
      name: "check_for_updates",
      description: "Check for a newer Sageport release.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: RefreshCw,
    labelKey: "ai.tool.checkForUpdates",
    requiresApproval: true,
    execute: async () => checkForUpdates(),
  },
  {
    spec: {
      name: "install_update",
      description: "Download and install the available Sageport update.",
      parameters: EMPTY_PARAMETERS,
    },
    icon: RefreshCw,
    labelKey: "ai.tool.installUpdate",
    requiresApproval: true,
    alwaysRequireApproval: true,
    execute: async () => installUpdate(),
  },
];
