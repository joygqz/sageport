/**
 * English dictionary, the single source of truth for translation keys.
 * Its shape defines the `Dictionary` type, so every other locale is checked
 * against it and missing or extra keys surface as type errors.
 *
 * Copy style follows GitHub: sentence case, plain complete sentences,
 * commas and periods only.
 */
export const en = {
  common: {
    add: "Add",
    cancel: "Cancel",
    copy: "Copy",
    copied: "Copied",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    rename: "Rename",
    save: "Save",
    saveChanges: "Save changes",
    auth: {
      password: "Password",
      key: "SSH key",
      agent: "SSH agent",
    },
  },

  windowControls: {
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore",
    close: "Close",
  },

  titleBar: {
    commandCenter: "Search hosts",
    togglePanel: "Toggle file transfer panel",
    toggleAssistant: "Toggle AI assistant",
  },

  activityBar: {
    hosts: "Hosts",
    credentials: "Credentials",
    snippets: "Snippets",
    settings: "Settings",
  },

  watermark: {
    quickConnect: "Connect to a host",
    commands: "Show all commands",
    newHost: "Add a host",
    settings: "Open settings",
  },

  palette: {
    quickPlaceholder: "Search hosts by name, address or user",
    commandsPlaceholder: "Search commands",
    noHosts: "No matching hosts",
    noCommands: "No matching commands",
  },

  commands: {
    category: {
      hosts: "Hosts",
      view: "View",
      preferences: "Preferences",
      theme: "Theme",
    },
    host: { new: "Add host" },
    group: { new: "Add group" },
    view: {
      toggleSidebar: "Toggle side bar",
      togglePanel: "Toggle file transfer panel",
      toggleAssistant: "Toggle AI assistant",
    },
    tab: { close: "Close tab" },
    settings: { open: "Open settings" },
  },

  editor: {
    newSession: "New session",
    closeTab: "Close tab",
  },

  statusBar: {
    version: "v{version}",
    transfers: "{count} transferring",
    syncOn: "Sync on",
    syncOff: "Sync off",
    lastSynced: "Last synced {time}",
    updateAvailable: "Update available",
    updateReady: "Restart to update",
  },

  terminal: {
    connecting: "Connecting to {host}",
    connectFailed: "Connection failed",
    closed: "Session ended",
    reconnect: "Reconnect",
    status: {
      idle: "Idle",
      connecting: "Connecting",
      connected: "Connected",
      closed: "Disconnected",
      error: "Error",
    },
    search: {
      placeholder: "Find",
      noResults: "No results",
      previous: "Previous match",
      next: "Next match",
      close: "Close find",
    },
  },

  hosts: {
    viewTitle: "Hosts",
    filterPlaceholder: "Filter hosts",
    newHost: "New host",
    newGroup: "New group",
    noMatches: "No hosts match your filter",
    empty: {
      title: "No hosts yet",
      description: "Add a host to start a terminal session.",
    },
    ungrouped: "Ungrouped",
    connect: "Connect",
    openSftp: "Browse files",
    deleteHost: {
      title: "Delete host",
      description: "This permanently deletes {label} and cannot be undone.",
      error: "Failed to delete host",
    },
    deleteGroup: {
      title: "Delete group",
      description: "This permanently deletes {name} and cannot be undone.",
      withHostsDescription:
        "{name} contains {count} hosts. Choose what happens to them.",
      keepHosts: "Delete group only",
      withHosts: "Delete group and hosts",
      error: "Failed to delete group",
    },
  },

  hostForm: {
    newTitle: "New host",
    editTitle: "Edit host",
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
    customCredentials: "Custom credentials",
    usingIdentityHint:
      "Username and authentication come from the selected identity.",
    username: "Username",
    usernamePlaceholder: "root",
    authentication: "Authentication",
    password: "Password",
    passwordKeepHint: "Leave blank to keep the current password.",
    sshKey: "SSH key",
    selectKey: "Select a key",
    noKeysHint: "No keys yet. Add one in the Credentials view.",
    notes: "Notes",
    notesPlaceholder: "Optional notes about this host",
    create: "Create host",
    saveError: "Failed to save host",
  },

  groupForm: {
    newTitle: "New group",
    editTitle: "Rename group",
    name: "Name",
    namePlaceholder: "Production",
    nameRequired: "Name is required",
    saveError: "Failed to save group",
  },

  credentials: {
    viewTitle: "Credentials",
    keys: {
      sectionTitle: "SSH keys",
      add: "Add key",
      formTitle: "Add SSH key",
      modeGenerate: "Generate",
      modeImport: "Import",
      name: "Name",
      namePlaceholder: "prod-deploy-key",
      nameRequired: "Name is required",
      algorithmLabel: "Algorithm",
      algorithm: {
        ed25519: "Ed25519, recommended",
        rsa2048: "RSA 2048",
        rsa4096: "RSA 4096",
        ecdsaP256: "ECDSA P-256",
        ecdsaP384: "ECDSA P-384",
        ecdsaP521: "ECDSA P-521",
      },
      passphrase: "Passphrase",
      passphraseHint: "Required only if the key is encrypted.",
      generatePassphraseHint: "Optional. Encrypts the generated private key.",
      privateKey: "Private key",
      privateKeyHint: "PEM or OpenSSH format.",
      privateKeyRequired: "Private key is required",
      chooseFile: "Choose file",
      import: {
        chooseFile: "Choose a private key file",
        readError: "Failed to read key file",
      },
      generateAction: "Generate key",
      importAction: "Save key",
      copyPublicKey: "Copy public key",
      empty: "No keys yet. Generate one or import an existing key.",
      addError: "Failed to save key",
      delete: {
        title: "Delete key",
        description: "This permanently deletes {name} and cannot be undone.",
        error: "Failed to delete key",
        inUse:
          "This key is still used by hosts or identities. Reassign them before deleting it.",
      },
    },
    identities: {
      sectionTitle: "Identities",
      add: "Add identity",
      newTitle: "New identity",
      editTitle: "Edit identity",
      name: "Name",
      namePlaceholder: "Production root",
      username: "Username",
      authentication: "Authentication",
      password: "Password",
      passwordKeepHint: "Leave blank to keep the current password.",
      sshKey: "SSH key",
      noKeysHint: "Add an SSH key first to use key authentication.",
      empty:
        "No identities yet. An identity bundles a username with an authentication method so many hosts can share one login.",
      nameUsernameRequired: "Name and username are required",
      saveError: "Failed to save identity",
      delete: {
        title: "Delete identity",
        description: "This permanently deletes {name} and cannot be undone.",
        error: "Failed to delete identity",
        inUse:
          "This identity is still used by hosts. Reassign them before deleting it.",
      },
    },
  },

  snippets: {
    viewTitle: "Snippets",
    new: "New snippet",
    newTitle: "New snippet",
    editTitle: "Edit snippet",
    name: "Name",
    namePlaceholder: "Tail nginx errors",
    command: "Command",
    commandPlaceholder: "tail -f /var/log/nginx/error.log",
    description: "Description",
    descriptionPlaceholder: "Optional",
    empty: {
      title: "No snippets yet",
      description:
        "Save commands you run often and send them to a terminal with one click.",
    },
    nameCommandRequired: "Name and command are required",
    saveError: "Failed to save snippet",
    delete: {
      title: "Delete snippet",
      description: "This permanently deletes {name} and cannot be undone.",
      error: "Failed to delete snippet",
    },
    run: "Run in terminal",
    sent: "Sent to terminal",
    noTerminal: "No terminal session is open",
  },

  sftp: {
    panelTitle: "File transfer",
    hidePanel: "Hide panel",
    local: "Local",
    newTab: "New tab",
    up: "Parent folder",
    refresh: "Refresh",
    pathPlaceholder: "Enter a path and press Enter",
    newFolder: "New folder",
    rename: "Rename",
    open: "Open",
    sendLeft: "Copy to left pane",
    sendRight: "Copy to right pane",
    sendLeftCompressed: "Copy to left pane compressed",
    sendRightCompressed: "Copy to right pane compressed",
    phase: {
      compressing: "compressing",
      transferring: "transferring",
      extracting: "extracting",
    },
    emptyDir: "This folder is empty",
    noTabTitle: "No location open",
    deleteConfirm: "This permanently deletes {name} and cannot be undone.",
    mkdirError: "Failed to create folder",
    renameError: "Failed to rename",
    deleteError: "Failed to delete",
    cancelTransfer: "Cancel transfer",
    history: {
      title: "Transfer history",
      empty: "No transfers yet",
      clear: "Clear history",
      clearConfirm: "This removes all transfer history and cannot be undone.",
      deleteConfirm: "This removes the entry from the transfer history.",
      clearError: "Failed to update history",
      loadError: "Failed to load transfer history",
      status: {
        active: "In progress",
        done: "Done",
        error: "Failed",
        cancelled: "Cancelled",
      },
    },
  },

  ai: {
    viewTitle: "AI assistant",
    hidePanel: "Hide panel",
    setup: {
      title: "Set up the assistant",
      description:
        "Connect an OpenAI or Anthropic compatible endpoint to start chatting.",
      action: "Open settings",
    },
    empty: {
      title: "Ask the assistant",
      description:
        "It can read your terminal sessions and suggest commands. Anything it runs on a server needs your approval first.",
    },
    newChat: "New chat",
    history: "Chat history",
    noSessions: "No chats yet",
    untitledChat: "New chat",
    renameSession: "Rename chat",
    deleteSession: {
      title: "Delete chat",
      description: "This permanently deletes {title} and cannot be undone.",
    },
    working: "Working",
    stop: "Stop generating",
    stepLimitReached:
      "Step limit reached. Rephrase or split the request and try again.",
    inputPlaceholder: "Ask about your servers",
    commandLabel: "Command",
    error: "Assistant error",
    confirmRun: "Wants to run this command in your terminal",
    approve: "Allow",
    deny: "Deny",
    modelLabel: "Model",
    modelLoading: "Loading models",
    tool: {
      listTerminalSessions: "List terminal sessions",
      readTerminalOutput: "Read terminal output",
      runTerminalCommand: "Run terminal command",
    },
  },

  settings: {
    title: "Settings",
    nav: {
      appearance: "Appearance",
      ai: "AI",
      sync: "Sync",
      about: "About",
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how Sageport looks. Each theme styles the whole app including the terminal.",
      language: "Language",
      languageHint: "Sets the display language of the app.",
    },
    ai: {
      title: "AI provider",
      description:
        "Bring your own API key. Works with Anthropic and any OpenAI compatible endpoint.",
      protocolLabel: "API format",
      protocol_openai: "OpenAI compatible",
      protocol_anthropic: "Anthropic compatible",
      baseUrlLabel: "Base URL",
      baseUrlHint: "OpenAI compatible endpoints usually end with /v1.",
      apiKeyLabel: "API key",
      apiKeyHint: "Stored on this device only.",
      apiKeyHintSaved: "A key is saved. Enter a new one to replace it.",
      apiKeyPlaceholderSaved: "••••••••",
      saved: "Configuration saved",
      saveError: "Failed to save configuration",
    },
    sync: {
      exportButton: "Export to file",
      importButton: "Restore from file",
      exportDialogTitle: "Export encrypted backup",
      importDialogTitle: "Restore encrypted backup",
      vaultFilterName: "Sageport backup",
      exportedTitle: "Backup exported",
      exportFailed: "Export failed",
      importedTitle: "Backup restored",
      importFailed: "Restore failed",
      connect: {
        title: "Sync",
        description:
          "Back up your data to a secret GitHub gist, encrypted end to end with your passphrase.",
        tokenLabel: "GitHub access token",
        tokenHint: "Needs the gist scope only.",
        passphraseLabel: "Vault passphrase",
        passphraseHint:
          "Use the same passphrase on every device. It never leaves this device.",
        connectButton: "Connect",
        connectedHint:
          "This device backs up to and restores from the linked gist. Disconnect to change the token or passphrase.",
        connectError: "Failed to connect",
        linkedLabel: "Linked gist",
        lastSyncedLabel: "Last synced",
        neverSynced: "Never",
        pushButton: "Back up now",
        disconnectButton: "Disconnect",
        pushedTitle: "Backup complete",
        pushFailed: "Backup failed",
        disconnectError: "Failed to disconnect",
        disconnectConfirmTitle: "Disconnect sync",
        disconnectConfirmDescription:
          "This device stops backing up to the linked gist. The remote backup itself is kept.",
        disconnectConfirmButton: "Disconnect",
        mismatchTitle: "Passphrase does not match",
        mismatchDescription:
          "This passphrase cannot decrypt the existing backup. Enter the original passphrase, or overwrite the remote backup with the data on this device.",
        mismatchCancelButton: "Try again",
        mismatchForceButton: "Overwrite remote backup",
      },
      versions: {
        title: "Backup history",
        description:
          "Restoring replaces all local data with the selected backup and cannot be undone.",
        loadError: "Failed to load backup history",
        empty: "No backups yet",
        latestBadge: "Latest",
        changesLabel: "+{additions} -{deletions}",
        restoreButton: "Restore",
        restoreConfirmTitle: "Restore this backup",
        restoreConfirmDescription:
          "All local data will be replaced by the selected backup. Changes made since then are lost and cannot be recovered.",
        restoreConfirmButton: "Restore and overwrite",
        cancelButton: "Cancel",
        restoredTitle: "Backup restored",
        restoreFailed: "Restore failed",
      },
      file: {
        title: "File backup",
        description:
          "Export an encrypted backup file or restore from one. The passphrase is asked each time and never stored.",
        passphraseDialogTitle: "Enter backup passphrase",
        passphraseDialogConfirm: "Continue",
      },
    },
    about: {
      version: "Version {version}",
      update: {
        check: "Check for updates",
        checking: "Checking for updates",
        upToDate: "Sageport is up to date.",
        available: "Version {version} is available.",
        install: "Download and install",
        downloading: "Downloading",
        downloadingProgress: "Downloading {percent}%",
        ready: "Version {version} is ready to install.",
        readyBadge: "Ready",
        restart: "Restart to update",
        error: "Update check failed. {message}",
      },
    },
  },
} as const;

export type Dictionary = DeepString<typeof en>;

/**
 * Relaxes the `as const` literal types above to plain `string` leaves so
 * other locales can supply different text with the exact same structure.
 */
type DeepString<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepString<T[K]>;
};
