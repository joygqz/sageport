<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**SSH workbench with integrated SFTP, credential management, and an AI assistant**

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Features](#features) · [Quick start](#quick-start) · [Security](#security)

</div>

---

![Sageport workbench](docs/screenshot.png)

Sageport consolidates the tools of routine server operations — terminal, file transfer, key management, and command snippets — into a single desktop application with a VSCode-style layout: activity bar, side bar, tabbed editor area, bottom panel, and command palette. All data is stored in a local SQLite database; optional multi-device sync transmits only end-to-end encrypted ciphertext.

## Features

**Terminal** — GPU-accelerated rendering via xterm.js with WebGL, built on a pure-Rust SSH stack (russh). Tabbed concurrent sessions that persist in the background without reflow, keepalives with one-click reconnect, scrollback search (<kbd>⌘</kbd> <kbd>F</kbd>), clickable links, and full Unicode support. Inline autocomplete suggests commands from your history as you type, and input can be broadcast to every connected session at once. Local shell tabs run alongside SSH sessions, and typing `user@host` in the command palette connects immediately — no saved host required.

**Hosts & credentials** — Hosts organized into collapsible groups with live connection indicators, jump-host (ProxyJump) chains, per-host startup commands, and one-click import from your existing `~/.ssh/config`. Connections verify host keys on first use and support the system SSH agent. Credentials are decoupled from hosts, so one identity can be reused across servers. The built-in key manager generates and imports Ed25519, RSA, and ECDSA keys in OpenSSH format, with optional passphrase protection.

**File transfer & editing** — Dual-pane browser where each pane can show the local filesystem or an SFTP connection. Drag-and-drop transfer in both directions, in-transit archiving for directories with many small files, a permissions editor, path bookmarks, and a complete transfer history. Text files open in an editor tab with syntax highlighting and save straight back over SFTP.

**Monitoring** — A dedicated sidebar shows live CPU, memory, disk, and network statistics for connected hosts, with a compact summary for the active host in the status bar.

**Port forwarding** — Local (`-L`) and dynamic SOCKS (`-D`) tunnels with start/stop control, live status, and optional auto-start on launch — routed over jump-host chains when configured.

**Snippets** — Frequently used commands with `{{variable}}` placeholders, sent to the active terminal or run across many hosts at once with per-host results.

**AI assistant** — Bring your own API key; supports Anthropic and any OpenAI-compatible endpoint with configurable base URL and model, with prompt caching to cut token costs. The assistant works with your workbench through tools: it can list saved hosts, open connections, inspect terminal output, and propose commands. Supervised mode requires confirmation for operations; an explicitly enabled Autonomous mode approves them automatically while still asking when scope is ambiguous. Conversations are stored locally.

**Sync & backup** — Cross-device sync through one of five providers — GitHub Gist, Google Drive, and Microsoft OneDrive via OAuth, or WebDAV and S3 with your own credentials — encrypted end to end with a passphrase-derived key. Only ciphertext ever leaves the device. Syncs hosts, credentials, snippets, port forwards, bookmarks, and interface preferences (locale, theme, zoom). Automatic last-write-wins conflict resolution, revision history with restore, and encrypted export/import for offline backups.

**Interface** — Six full themes (terminal palette included), English and Simplified Chinese localization, whole-UI zoom, command palette (<kbd>⌘</kbd> <kbd>P</kbd> / <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>P</kbd>), and automatic updates.

## Installation

Download from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| Platform | Package                        |
| -------- | ------------------------------ |
| macOS    | `.dmg` (Apple Silicon / Intel) |
| Windows  | `.msi` / `.exe`                |
| Linux    | `.deb` / `.rpm` / `.AppImage`  |

The application updates itself; the status bar indicates when a new version is available.

## Quick start

1. **Add a host** — <kbd>⌘</kbd> <kbd>N</kbd>, then enter the address and choose password or key authentication — or just type `user@host` in the command palette to connect right away.
2. **Connect** — <kbd>⌘</kbd> <kbd>P</kbd>, type the host name, press Enter.
3. **Transfer files** — <kbd>⌘</kbd> <kbd>J</kbd> opens the dual-pane file panel.
4. **AI assistant** (optional) — set an API key under _Settings → AI_, then <kbd>⌘</kbd> <kbd>L</kbd> to chat.
5. **Sync** (optional) — under _Settings → Sync_, pick a provider (GitHub, Google Drive, OneDrive, WebDAV, or S3), authorize or enter credentials, then set a passphrase; enter the same passphrase on another device to restore.

On Windows and Linux, substitute <kbd>Ctrl</kbd> for <kbd>⌘</kbd>.

## Security

- All data resides in a local SQLite database; no cloud service is required.
- Sync and backups derive the encryption key from your passphrase with **Argon2id** and seal payloads with **AES-256-GCM**. Only ciphertext leaves the device; the passphrase never does. **A lost passphrase makes synced data unrecoverable.**
- AI assistant operations require approval by default. Autonomous mode is an explicit opt-in that automatically approves them, so enable it only for trusted hosts and tasks.

## Development

**Stack:** Tauri 2 + Rust · React 19 + TypeScript · Tailwind CSS 4 · Zustand + TanStack Query

```bash
# Prerequisites: https://tauri.app/start/prerequisites/ plus Node.js and pnpm
pnpm install        # install dependencies
pnpm tauri dev      # run in development mode
pnpm tauri build    # build installers
```

Additional scripts: `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm test`.

### Project layout

```
src/
  workbench/    Shell: activity bar, side bar, editor tabs, panel,
                status bar, command palette, keybindings
  features/     One folder per domain: hosts, terminal, sftp, snippets,
                credentials, forwards, monitor, ai, sync, settings, updates
  themes/       Theme definitions applied as CSS variables and shared with xterm
  components/   Reusable UI primitives
  lib/ipc.ts    Typed facade over all Tauri commands and events
  i18n/         Typed dictionaries: en, zh-CN

src-tauri/src/
  commands/     Thin Tauri command handlers
  repository/   SQLite persistence per entity
  ssh/ sftp/    russh session, SFTP, forwarding, and monitoring engines
  pty/          Local shell sessions via portable-pty
  sync/ crypto/ Vault snapshot, provider clients (Gist, Drive, OneDrive,
                WebDAV, S3), OAuth, Argon2id + AES-256-GCM
  ai/           Anthropic and OpenAI-compatible chat clients
```

Issues and pull requests are welcome.

## License

[GPL-3.0](LICENSE)
