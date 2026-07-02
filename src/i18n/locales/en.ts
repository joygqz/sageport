/**
 * English dictionary — the single source of truth for translation keys.
 * Its shape defines the `Dictionary` type, so every other locale is checked
 * against it and missing/extra keys surface as type errors.
 */
export const en = {
  common: {
    cancel: "Cancel",
    save: "Save",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    connect: "Connect",
    loading: "Loading…",
    copy: "Copy",
    copied: "Copied",
    newHost: "New host",
    newGroup: "New group",
    selectKey: "Select a key",
    runInTerminal: "Run in active terminal",
    sentToTerminal: "Sent to terminal",
    noActiveTerminalTitle: "No active terminal",
    noActiveTerminalDescription: "Open a session first.",
    auth: {
      password: "Password",
      key: "SSH key",
      agent: "SSH agent",
    },
  },

  windowTitles: {
    settings: "Settings",
    editHost: "Edit host",
    newHost: "New host",
    newGroup: "New group",
    editGroup: "Edit group",
    commandPalette: "Command palette",
  },

  titleBar: {
    searchPlaceholder: "Search hosts, run a command…",
    showAi: "Show AI assistant",
    hideAi: "Hide AI assistant",
    showSftp: "Show file transfer",
    hideSftp: "Hide file transfer",
    toggleTheme: "Toggle theme",
    settings: "Settings",
  },

  sftp: {
    title: "File transfer",
    hide: "Hide panel",
    local: "Local",
    newTab: "New tab",
    up: "Parent folder",
    refresh: "Refresh",
    pathPlaceholder: "Enter a path and press Enter",
    newFolder: "New folder",
    rename: "Rename",
    open: "Open",
    sendLeft: "Copy to left",
    sendRight: "Copy to right",
    sendLeftCompressed: "Copy to left (compressed)",
    sendRightCompressed: "Copy to right (compressed)",
    phase: {
      compressing: "compressing",
      transferring: "transferring",
      extracting: "extracting",
    },
    emptyDir: "This folder is empty",
    noTabTitle: "No tab open",
    noTabDescription: "Open a local or remote tab to browse files.",
    deleteConfirm: "Delete “{name}”? This cannot be undone.",
    mkdirError: "Could not create folder",
    renameError: "Could not rename",
    deleteError: "Could not delete",
    cancel: "Cancel transfer",
    history: {
      title: "Transfer history",
      empty: "No transfers yet",
      emptyDescription: "Files you copy will show up here.",
      clear: "Clear",
      clearConfirm: "Clear all transfer history? This cannot be undone.",
      clearError: "Could not update history",
      loadError: "Could not load transfer history",
      status: {
        active: "In progress",
        done: "Done",
        error: "Failed",
        cancelled: "Cancelled",
      },
    },
  },

  commandPalette: {
    searchPlaceholder: "Search hosts to connect…",
    noHosts: "No hosts found.",
  },

  sidebar: {
    filterPlaceholder: "Filter hosts…",
    add: "Add",
    noMatchesTitle: "No matches",
    noMatchesDescription: "Try a different search.",
    emptyTitle: "No hosts yet",
    emptyDescription: "Add your first SSH host to get started.",
    ungrouped: "Ungrouped",
    hostDeleted: "Host deleted",
    deleteError: "Could not delete host",
    groupDeleted: "Group deleted",
    deleteGroupError: "Could not delete group",
  },

  workspace: {
    emptyTitle: "No active sessions",
    emptyDescription:
      "Double-click a host in the sidebar to open a terminal, or create your first host.",
    connecting: "Connecting to {host}…",
    connectingHint: "Establishing a secure SSH connection",
    connectFailed: "Connection failed",
    closed: "Session ended",
    closedHint: "The remote session has closed.",
    reconnect: "Reconnect",
  },

  app: {
    openHostError: "Could not open host",
  },

  settings: {
    tabs: {
      appearance: "Appearance",
      ai: "AI",
      keys: "Keys",
      identities: "Identities",
      snippets: "Snippets",
      sync: "Sync",
    },
    appearance: {
      theme: "Theme",
      light: "Light",
      dark: "Dark",
      system: "System",
      language: "Language",
    },
    ai: {
      protocolLabel: "API format",
      protocol_openai: "OpenAI-compatible",
      protocol_anthropic: "Anthropic-compatible",
      baseUrlLabel: "Base URL",
      baseUrlHint:
        "The API service address. OpenAI-compatible endpoints usually end with /v1.",
      apiKeyLabel: "API key",
      apiKeyHintSaved: "A key is already saved. Enter a new one to replace it.",
      apiKeyHint:
        "Required for the AI assistant. Stored securely on this device.",
      apiKeyPlaceholderSaved: "•••••••• (saved)",
      savedTitle: "Configuration saved",
      savedDescription: "The AI assistant is ready.",
      saveError: "Could not save configuration",
    },
    sync: {
      setPassphraseFirst: "Set a vault passphrase first",
      exportButton: "Export to file…",
      importButton: "Restore from file…",
      exportDialogTitle: "Export encrypted vault",
      importDialogTitle: "Import encrypted vault",
      vaultFilterName: "Sageport vault",
      exportedTitle: "Vault exported",
      exportedDescription: "Your encrypted data was written to disk.",
      exportFailed: "Export failed",
      importedTitle: "Vault restored",
      importedDescription: "Your data was merged (last-write-wins).",
      importFailed: "Restore failed",
      passphrase: {
        title: "Vault passphrase",
        description:
          "Encrypts everything before it ever leaves this device — used automatically for every gist backup, restore, and file export/import. Set it once per device; every device sharing a gist must use the exact same passphrase, or their backups become unreadable to each other.",
        label: "Passphrase",
        hint: "Not set yet — sync and file backup/restore are disabled until you set one.",
        hintSaved:
          "A passphrase is saved on this device. Enter a new one to replace it.",
        saved: "Passphrase saved",
        saveError: "Could not save passphrase",
      },
      gist: {
        title: "GitHub Gist sync",
        description:
          "Back up your encrypted vault — hosts, groups, identities, keys, snippets, and every app setting (e.g. AI config) — to a secret GitHub Gist and restore it on any device. The sync connection itself (token, gist link, passphrase) is never included. Only ciphertext is uploaded — GitHub never sees your data or passphrase. The linked gist is auto-discovered from your token, and every backup first merges in whatever another device already pushed, so concurrent edits aren't lost.",
        tokenLabel: "GitHub access token",
        tokenHint:
          "A personal access token with the “gist” scope. Create one at github.com/settings/tokens.",
        tokenHintSaved: "A token is saved. Enter a new one to replace it.",
        tokenSaved: "Token saved",
        tokenSaveError: "Could not save token",
        linkedLabel: "Linked gist:",
        lastSyncedLabel: "Last synced:",
        neverSynced: "Never",
        pushButton: "Back up now",
        disconnectButton: "Disconnect",
        pushedTitle: "Vault backed up",
        pushedDescription:
          "Remote changes were merged in and your encrypted data was pushed to the gist.",
        pushFailed: "Backup failed",
        disconnected: "Disconnected from gist",
        disconnectError: "Could not disconnect",
      },
      versions: {
        title: "Backup history",
        description:
          "Every backup is kept as a gist revision. Restoring one replaces the entire local vault — hosts, groups, identities, keys, snippets and settings — with that snapshot (your sync connection is left untouched). It isn't a merge, so anything changed locally since then is lost.",
        loadError: "Could not load backup history",
        empty: "No backups yet",
        emptyDescription: "Back up now to start building history.",
        latestBadge: "Latest",
        changesLabel: "+{additions} / -{deletions}",
        restoreButton: "Restore",
        restoreConfirmTitle: "Restore this backup?",
        restoreConfirmDescription:
          "This replaces every host, group, identity, key, snippet, and app setting on this device with the selected backup (your sync connection is left untouched). Anything added or changed locally since then will be lost. This cannot be undone.",
        restoreConfirmButton: "Restore and overwrite",
        cancelButton: "Cancel",
        restoredTitle: "Vault restored",
        restoredDescription: "Local data now matches the selected backup.",
        restoreFailed: "Restore failed",
      },
      file: {
        title: "Local file backup",
        description:
          "Export the encrypted vault — hosts, groups, identities, keys, snippets and settings — to a file you control, or restore one manually. Handy for offline backups or moving between devices without GitHub.",
      },
    },
  },

  hostForm: {
    label: "Label",
    labelRequired: "Label is required",
    labelPlaceholder: "Production web",
    group: "Group",
    noGroup: "No group",
    address: "Address",
    addressRequired: "Address is required",
    addressPlaceholder: "10.0.0.4 or host.example.com",
    port: "Port",
    credentials: "Credentials",
    usingIdentityHint:
      "Using a saved identity for username and authentication.",
    customCredentials: "Custom credentials",
    username: "Username",
    usernamePlaceholder: "root",
    authentication: "Authentication",
    password: "Password",
    passwordKeepHint: "Leave blank to keep the existing password.",
    sshKey: "SSH key",
    noKeysHint: "No keys yet — add one in Settings → Keys.",
    notes: "Notes",
    notesPlaceholder: "Optional notes about this host",
    saveChanges: "Save changes",
    createHost: "Create host",
    saveError: "Could not save host",
  },

  identities: {
    description: "Reusable credentials you can attach to any host.",
    addIdentity: "Add identity",
    name: "Name",
    namePlaceholder: "Production root",
    username: "Username",
    usernamePlaceholder: "root",
    authentication: "Authentication",
    password: "Password",
    sshKey: "SSH key",
    addKeyFirstHint: "Add a key in the Keys tab first.",
    saveIdentity: "Save identity",
    emptyTitle: "No identities yet",
    emptyDescription: "Create a reusable credential to share across hosts.",
    nameUsernameRequired: "Name and username are required",
    addedTitle: "Identity added",
    addError: "Could not add identity",
  },

  snippets: {
    description: "Saved commands you can run in the active terminal.",
    newSnippet: "New snippet",
    name: "Name",
    namePlaceholder: "Tail nginx errors",
    command: "Command",
    commandPlaceholder: "tail -f /var/log/nginx/error.log",
    descriptionLabel: "Description",
    descriptionPlaceholder: "Optional",
    saveSnippet: "Save snippet",
    emptyTitle: "No snippets yet",
    emptyDescription:
      "Save commands you run often and fire them into any session.",
    nameCommandRequired: "Name and command are required",
    savedTitle: "Snippet saved",
    saveError: "Could not save snippet",
  },

  keys: {
    description:
      "Private keys are stored securely on this device and sync to your other devices.",
    addKey: "Add key",
    generateNew: "Generate new key",
    importOrPaste: "Import / paste key",
    name: "Name",
    namePlaceholder: "prod-deploy-key",
    nameRequired: "Name is required",
    privateKey: "Private key",
    privateKeyHint: "PEM or OpenSSH format.",
    privateKeyPlaceholder: "-----BEGIN OPENSSH PRIVATE KEY-----",
    passphrase: "Passphrase",
    passphraseHint: "Optional — only if the key is encrypted.",
    generatePassphraseHint: "Optional — encrypts the generated private key.",
    saveKey: "Save key",
    chooseFile: "Choose file…",
    algorithmLabel: "Algorithm",
    algorithmHint: "Ed25519 is recommended: more secure, faster, shorter keys.",
    algorithm: {
      ed25519: "Ed25519 (recommended)",
      rsa2048: "RSA 2048",
      rsa4096: "RSA 4096",
      ecdsaP256: "ECDSA P-256",
      ecdsaP384: "ECDSA P-384",
      ecdsaP521: "ECDSA P-521",
    },
    generateButton: "Generate key",
    generatedTitle: "Key generated",
    copyPublicKey: "Copy public key",
    import: {
      chooseFileTitle: "Choose a private key file",
      readError: "Could not read key file",
    },
    emptyTitle: "No keys yet",
    emptyDescription:
      "Generate or import an SSH private key to use key-based authentication.",
    nameKeyRequired: "Name and private key are required",
    addedTitle: "Key added",
    addError: "Could not add key",
  },

  groups: {
    nameLabel: "Name",
    namePlaceholder: "New group name",
    nameRequired: "Name is required",
    saveError: "Could not save group",
  },

  ai: {
    assistant: "Assistant",
    connectTitle: "Connect the assistant",
    connectDescription:
      "Configure an OpenAI- or Anthropic-compatible endpoint in settings to get command suggestions and error explanations.",
    openSettings: "Open settings",
    modelLabel: "Model",
    modelLoading: "Loading models…",
    newChat: "New chat",
    history: "Show chat history",
    noSessions: "No chat history yet",
    untitledChat: "New chat",
    renameSession: "Rename chat",
    askTitle: "Ask the agent",
    askDescription:
      "It can inspect and act on your terminal sessions — e.g. find the 10 largest files under /var/log, or restart nginx and confirm it's healthy",
    thinking: "Working…",
    stepLimitReached:
      "Reached the step limit for this turn — try rephrasing or splitting the request into smaller steps.",
    inputPlaceholder: "Ask the agent anything…",
    commandLabel: "command",
    error: "Assistant error",
    confirmRun: "Wants to run this in your terminal",
    approve: "Allow",
    deny: "Deny",
    tool: {
      listTerminalSessions: "Listing terminal sessions",
      readTerminalOutput: "Reading terminal output",
      runTerminalCommand: "Run terminal command",
    },
  },
} as const;

export type Dictionary = DeepString<typeof en>;

/**
 * Relaxes the `as const` literal types above to plain `string` leaves so other
 * locales can supply different text while keeping the exact same structure.
 */
type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>;
};
