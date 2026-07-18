<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**A modern SSH workbench — terminal, SFTP, key management, and an AI assistant in one desktop app**

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Highlights](#highlights) · [Features](#features) · [Quick start](#quick-start) · [Security](#security)

</div>

---

![Sageport workbench](docs/screenshot.png)

Sageport brings every tool of routine server work — terminal, file transfer, key management, monitoring, and command snippets — into a single VSCode-style desktop app. Everything lives in a local SQLite database; optional multi-device sync moves only end-to-end encrypted ciphertext.

## Highlights

- **All your server tools in one window** — SSH terminal, SFTP, credentials, monitoring, port forwarding, and snippets, laid out like VSCode: activity bar, side bar, tabbed editor area, bottom panel, and command palette.
- **A terminal that keeps up** — GPU-accelerated xterm.js (WebGL) on a pure-Rust SSH stack (russh), with inline history autocomplete, scrollback search, and broadcast-to-all-sessions.
- **An AI assistant that operates the workbench** — beyond chat, it lists hosts, opens connections, reads terminal output, and proposes or runs commands through guarded tools — in supervised or autonomous mode.
- **End-to-end encrypted multi-device sync** — five providers (GitHub Gist, Google Drive, OneDrive, WebDAV, S3), keys derived with Argon2id and payloads sealed with AES-256-GCM. Only ciphertext ever leaves the device.
- **Local-first, no account required** — application data stays on the device; sensitive fields in SQLite are encrypted with a key held by the operating-system credential store. The cloud is strictly opt-in.
- **Cross-platform & self-updating** — a lightweight native app for macOS, Windows, and Linux, built on Tauri 2.

## Features

**Terminal** — GPU-accelerated rendering via xterm.js with WebGL, on a pure-Rust SSH stack (russh).

- Tabbed concurrent sessions that persist in the background without reflow
- Restores the previous terminal workspace after relaunch without reconnecting to servers until you choose to
- Keepalives with one-click reconnect
- Scrollback search (<kbd>⌘</kbd> <kbd>F</kbd>), clickable links, and full Unicode support
- Inline autocomplete suggests commands from your history as you type
- Broadcast input to every connected session at once
- Local shell tabs alongside SSH — type `user@host` in the command palette to connect with no saved host

**Hosts & credentials** — Hosts organized into collapsible groups with live connection indicators.

- Jump-host (ProxyJump) chains and per-host startup commands
- One-click import from your existing `~/.ssh/config`
- Host-key verification on first use and system SSH-agent support
- Credentials decoupled from hosts, so one identity can be reused across servers
- Nested groups with drag-and-drop host organization
- Built-in key manager generates and imports Ed25519, RSA, and ECDSA keys in OpenSSH format, with optional passphrase protection

**File transfer & editing** — Dual-pane browser where each pane can show the local filesystem or an SFTP connection.

- Drag-and-drop transfer in both directions
- In-transit archiving for directories with many small files
- Back/forward navigation history, path bookmarks, and inline file and folder creation
- Permissions editor and a complete transfer history
- Safe conflict handling (replace, skip, or keep both), batch decisions, cancellation, and one-click retry
- Open text files in an editor tab with syntax highlighting and save straight back over SFTP

**Monitoring** — A dedicated sidebar shows live CPU, memory, disk, and network statistics for connected hosts, with a compact summary for the active host in the status bar.

**Port forwarding** — Local (`-L`), remote (`-R`), and dynamic SOCKS (`-D`) tunnels with start/stop control, live status, and optional auto-start on launch — routed over jump-host chains when configured.

**Snippets** — Frequently used commands with `{{variable}}` placeholders, sent to the active terminal or run across many hosts at once with per-host results.

**AI assistant** — Bring your own API key; supports Anthropic and any OpenAI-compatible endpoint with configurable base URL and model, plus prompt caching to cut token costs.

- Works through your workbench: lists saved hosts, opens connections, inspects terminal output, and proposes commands
- Supervised mode requires confirmation for operations; explicitly enabled Autonomous mode approves them automatically while still asking when scope is ambiguous. Hosts marked as requiring approval remain manually gated.
- Conversations are stored locally

**Sync & backup** — Cross-device sync through one of five providers — GitHub Gist, Google Drive, and Microsoft OneDrive via OAuth, or WebDAV and S3 with your own credentials.

- End-to-end encrypted with a passphrase-derived key; only ciphertext ever leaves the device
- Syncs hosts, credentials, snippets, port forwards, bookmarks, and interface preferences (locale, theme, zoom)
- Automatic last-write-wins conflict resolution and revision history with restore
- Periodic background synchronization with bounded exponential retry while a provider is connected
- Encrypted export/import for offline backups

**Interface** — Three theme families (Midnight, Graphite, Dracula), each with light and dark variants and a matching terminal palette, switching automatically with the system if you like; English and Simplified Chinese localization, whole-UI zoom, command palette (<kbd>⌘</kbd> <kbd>P</kbd> / <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>P</kbd>), and automatic updates.

Use <kbd>⌘</kbd> <kbd>1</kbd> through <kbd>⌘</kbd> <kbd>8</kbd> to jump to a session tab, or <kbd>⌘</kbd> <kbd>9</kbd> for the last tab. All major sidebars and settings pages are also available from the command palette.

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

- Application data remains on the device; no cloud service is required. Passwords, private keys, passphrases, AI API keys, and sync credentials are encrypted at rest with **AES-256-GCM**. The random database master key is stored separately in the operating-system credential store (macOS Keychain, Windows Credential Manager, or Linux Secret Service).
- Sync and backups derive the encryption key from your passphrase with **Argon2id** and seal payloads with **AES-256-GCM**. Only ciphertext leaves the device; the passphrase never does. **A lost passphrase makes synced data unrecoverable.**
- AI assistant operations require approval by default. Autonomous mode is an explicit opt-in that automatically approves them, so enable it only for trusted hosts and tasks.

## License

[GPL-3.0-only](LICENSE)
