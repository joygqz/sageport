<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**An ops focused SSH workbench with a built in AI assistant**

Terminal, file transfer, credentials and an AI copilot in one window, arranged like the editor you already know.

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Features](#features) · [Getting started](#getting-started) · [Data and security](#data-and-security)

</div>

---

## Why Sageport

Routine ops work usually means juggling a terminal app, an SFTP client, a notes file full of commands and a key manager. Sageport puts all of that in a single window with the layout language of a modern code editor, so every tool is one keystroke away and none of them steals your focus.

An AI assistant sits beside your sessions. It can read terminal output to diagnose errors and suggest commands, but it never acts on its own. Every command it wants to run on a server shows a confirmation you can decline.

Your data stays yours. Everything lives in a local SQLite database, and optional multi device sync ships only ciphertext to a secret GitHub Gist, encrypted end to end with a passphrase that never leaves your device.

## The workbench

Sageport is organized like an editor, not a website.

- **Activity bar** switches the side bar between hosts, credentials and snippets.
- **Side bar** holds the host explorer with collapsible groups, live connection indicators and context menus.
- **Editor area** hosts terminal sessions and the settings page as tabs. Terminals stay alive in the background when you switch tabs.
- **Panel** at the bottom is a dual pane file browser for SFTP and local files, with drag and drop transfer between the panes.
- **Auxiliary bar** on the right docks the AI assistant.
- **Status bar** shows the active session, transfer progress, sync state and available updates. Every item is clickable.
- **Command palette** opens with <kbd>⌘P</kbd> to search and connect to hosts, and with <kbd>⌘⇧P</kbd> to run any command, exactly like VSCode quick open.

Common shortcuts: <kbd>⌘N</kbd> new host, <kbd>⌘B</kbd> toggle side bar, <kbd>⌘J</kbd> toggle panel, <kbd>⌘L</kbd> toggle assistant, <kbd>⌘W</kbd> close tab, <kbd>⌘F</kbd> find in terminal, <kbd>⌘+</kbd>/<kbd>⌘−</kbd>/<kbd>⌘0</kbd> terminal zoom, <kbd>⌘,</kbd> settings. On Windows and Linux use <kbd>Ctrl</kbd>.

## Features

### Terminal

Sessions render through xterm.js with GPU acceleration, so output stays smooth under heavy load. Multiple sessions run side by side as tabs, with clickable links, full Unicode support and 10000 lines of scrollback. A VSCode style find bar (<kbd>⌘F</kbd>) searches the scrollback with match highlighting, and the font size zooms across every session with <kbd>⌘+</kbd>/<kbd>⌘−</kbd>.

Connections are kept alive with protocol level keepalives, and a lost connection shows a clear overlay with a one click reconnect. Switching tabs never reflows the terminal — hidden sessions keep their exact size, so there is no flicker.

### Hosts and credentials

Hosts are organized into groups and filterable in place. Credentials are decoupled from hosts, so a single identity, which is a username plus a password or key, can be reused across many servers.

The built in key manager generates or imports Ed25519, RSA and ECDSA keys in standard OpenSSH format, with optional passphrase protection and one click public key copy.

### File transfer

The bottom panel is a dual pane browser. Either side can show the local filesystem or an SFTP connection, and files move between them by drag and drop or from the context menu. Folders can be archived and compressed in transit, which keeps transfers fast when thousands of small files are involved. A history view records every transfer.

### Snippets

Save the commands you run often and send them to the current terminal with one click, a double click on the row, or from the AI assistant's code blocks.

### AI assistant

Bring your own API key. Sageport works with Anthropic and any OpenAI compatible endpoint, with a configurable base URL and model picker.

Replies stream in token by token and a run can be stopped mid generation. The assistant knows which sessions are open and which one you are looking at, and it can list sessions, read their output and run commands, so it troubleshoots with real context instead of pasted logs. Every remote command it proposes always prompts for confirmation first. Conversations are saved locally and can be renamed or deleted.

### Sync and backup

One passphrase encrypts all your data, which then syncs across devices through a secret GitHub Gist. There is no account to create and no third party server that ever sees plaintext. Conflicts resolve automatically with last write wins merging, and a backup history lets you restore any previous revision. Encrypted export and import files cover offline backups.

### Themes

Six complete themes, each styling the entire app including the terminal palette: Dark Modern, GitHub Dark, One Dark, Light Modern, GitHub Light and Solarized Light. Switch from settings or straight from the command palette.

The interface is available in English and Simplified Chinese, and the app updates itself automatically.

## Installation

Download the installer for your platform from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` (Apple Silicon / Intel) |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

No manual upgrades needed. The status bar shows when a new version is ready.

## Getting started

1. **Add a host.** Press <kbd>⌘N</kbd> or use the plus button in the hosts view, then enter the address and pick password or key authentication.
2. **Connect.** Press <kbd>⌘P</kbd>, type a few letters of the host name and hit Enter. Double clicking the host in the side bar works too.
3. **Transfer files.** Press <kbd>⌘J</kbd> to open the file panel, or choose Browse files on a host to open it over SFTP.
4. **Set up the assistant, optional.** Open Settings, AI, enter your API key and pick a model, then press <kbd>⌘L</kbd> to chat.
5. **Enable sync, optional.** Open Settings, Sync, provide a GitHub token with the gist scope and a passphrase. Enter the same passphrase on another device to pull your entire configuration.

## Data and security

All data lives in a local SQLite database, so nothing requires a cloud service to function.

Sync and backups derive a key from your passphrase with Argon2id and seal the payload with AES-256-GCM. Only ciphertext ever reaches the Gist, and the passphrase never leaves your device. **If you lose the passphrase the data cannot be recovered, so keep it safe.**

Every remote command the AI assistant initiates runs only after you approve it, and the entire codebase is open for audit.

## Development

Tech stack: Tauri 2 + Rust · React 19 + TypeScript · Tailwind CSS 4 · Zustand + TanStack Query

```bash
# Prerequisites: Rust, Node.js, pnpm
pnpm install

# Development mode
pnpm tauri dev

# Build installers
pnpm tauri build
```

### Architecture

```
src/
  workbench/    Shell: activity bar, side bar, editor tabs, panel,
                status bar, command palette, keybindings
  features/     One folder per domain: hosts, terminal, sftp, snippets,
                credentials, ai, sync, settings, updates
  themes/       Complete theme definitions in TypeScript, applied as CSS
                variables and fed to xterm from the same source
  components/   Reusable UI primitives
  lib/ipc.ts    Typed facade over every Tauri command and event
  i18n/         Typed dictionaries, en and zh-CN

src-tauri/src/
  commands/     Thin Tauri command handlers
  repository/   SQLite persistence per entity
  ssh/ sftp/    Session and transfer engines
  sync/ crypto/ Vault snapshot, Gist client, Argon2id + AES-256-GCM
  ai/           Anthropic and OpenAI compatible chat clients
```

Useful scripts: `pnpm lint`, `pnpm typecheck`, `pnpm format`.

Issues and pull requests are welcome.

## License

[GPL-3.0](LICENSE)
