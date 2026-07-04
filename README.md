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

**Terminal** — GPU-accelerated rendering via xterm.js with WebGL. Tabbed concurrent sessions that persist in the background without reflow, protocol-level keepalives with one-click reconnect, scrollback search (<kbd>⌘ F</kbd>), clickable links, and full Unicode support.

**Hosts & credentials** — Hosts organized into collapsible groups with live connection indicators. Credentials are decoupled from hosts, so one identity can be reused across servers. The built-in key manager generates and imports Ed25519, RSA, and ECDSA keys in OpenSSH format, with optional passphrase protection.

**File transfer** — Dual-pane browser where each pane can show the local filesystem or an SFTP connection. Drag-and-drop transfer in both directions, in-transit archiving for directories with many small files, and a complete transfer history.

**Snippets** — Frequently used commands, sent to the active terminal with a single click.

**AI assistant** — Bring your own API key; supports Anthropic and any OpenAI-compatible endpoint with configurable base URL and model. The assistant can list open sessions, read terminal output, and propose commands — every remote command requires explicit confirmation before it runs. Conversations are stored locally.

**Sync & backup** — Cross-device sync through a secret GitHub Gist, encrypted end to end with a passphrase-derived key. No account, no server that sees plaintext. Automatic last-write-wins conflict resolution, revision history with restore, and encrypted export/import for offline backups.

**Interface** — Six full themes (terminal palette included), English and Simplified Chinese localization, whole-UI zoom, command palette (<kbd>⌘ P</kbd> / <kbd>⌘ ⇧ P</kbd>), and automatic updates.

## Installation

Download from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` (Apple Silicon / Intel) |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

The application updates itself; the status bar indicates when a new version is available.

## Quick start

1. **Add a host** — <kbd>⌘ N</kbd>, then enter the address and choose password or key authentication.
2. **Connect** — <kbd>⌘ P</kbd>, type the host name, press Enter.
3. **Transfer files** — <kbd>⌘ J</kbd> opens the dual-pane file panel.
4. **AI assistant** (optional) — set an API key under *Settings → AI*, then <kbd>⌘ L</kbd> to chat.
5. **Sync** (optional) — under *Settings → Sync*, provide a GitHub token with the `gist` scope and a passphrase; enter the same passphrase on another device to restore.

On Windows and Linux, substitute <kbd>Ctrl</kbd> for <kbd>⌘</kbd>.

## Security

- All data resides in a local SQLite database; no cloud service is required.
- Sync and backups derive the encryption key from your passphrase with **Argon2id** and seal payloads with **AES-256-GCM**. Only ciphertext leaves the device; the passphrase never does. **A lost passphrase makes synced data unrecoverable.**
- Every remote command initiated by the AI assistant executes only after user approval.

## Development

**Stack:** Tauri 2 + Rust · React 19 + TypeScript · Tailwind CSS 4 · Zustand + TanStack Query

```bash
# Prerequisites: https://tauri.app/start/prerequisites/ plus Node.js and pnpm
pnpm install        # install dependencies
pnpm tauri dev      # run in development mode
pnpm tauri build    # build installers
```

Additional scripts: `pnpm lint`, `pnpm typecheck`, `pnpm format`.

### Project layout

```
src/
  workbench/    Shell: activity bar, side bar, editor tabs, panel,
                status bar, command palette, keybindings
  features/     One folder per domain: hosts, terminal, sftp, snippets,
                credentials, ai, sync, settings, updates
  themes/       Theme definitions applied as CSS variables and shared with xterm
  components/   Reusable UI primitives
  lib/ipc.ts    Typed facade over all Tauri commands and events
  i18n/         Typed dictionaries: en, zh-CN

src-tauri/src/
  commands/     Thin Tauri command handlers
  repository/   SQLite persistence per entity
  ssh/ sftp/    Session and transfer engines
  sync/ crypto/ Vault snapshot, Gist client, Argon2id + AES-256-GCM
  ai/           Anthropic and OpenAI-compatible chat clients
```

Issues and pull requests are welcome.

## License

[GPL-3.0](LICENSE)
