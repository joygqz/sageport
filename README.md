<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**Connect, transfer, monitor, and operate your servers from one desktop app.**

An SSH workbench for beginners and operations teams — local-first, cross-platform, and open source.

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download Sageport](https://github.com/joygqz/sageport/releases/latest) · [Get started](#get-started-in-3-minutes) · [Security](#security)

</div>

![Sageport workbench](docs/screenshot.png)

Sageport replaces the usual mix of terminal windows, file-transfer tools, key managers, monitoring dashboards, and command notes. It works over standard SSH/SFTP, so there is **nothing to install on your servers** and **no Sageport account to create**.

## Why Sageport

| What you need             | What Sageport gives you                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Connect to a server       | Saved hosts, password/key/SSH-agent login, `~/.ssh/config` import, and jump hosts                |
| Work in several terminals | Tabs, split panes, local shells, reconnect, search, autocomplete, and broadcast input            |
| Move or edit files        | Two-pane SFTP, drag-and-drop transfers, conflict handling, and remote text editing               |
| Check server health       | Live CPU, memory, disk, and network metrics without deploying an agent                           |
| Repeat operations safely  | Reusable snippets, variables, startup commands, and batch runs with per-host results             |
| Reach private services    | Local, remote, and SOCKS port forwarding, including through jump hosts                           |
| Get AI assistance         | An assistant that can inspect the workbench and propose actions; approval is required by default |
| Use multiple devices      | Optional end-to-end encrypted sync and encrypted offline backups                                 |

Everything is presented in a familiar VS Code-style workspace with a command palette, keyboard shortcuts, light/dark themes, and English or Simplified Chinese UI.

## Download

Choose the installer for your computer from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| System                          | Download              |
| ------------------------------- | --------------------- |
| macOS (Apple Silicon and Intel) | Universal `.dmg`      |
| Windows (64-bit)                | `.exe` installer      |
| Linux (64-bit)                  | `.AppImage` or `.deb` |

Sageport checks for updates automatically and lets you install them from the app.

## Get started in 3 minutes

Have these ready: the server address, SSH port (usually `22`), username, and a password or private key.

1. **Add a server** — press <kbd>⌘</kbd> <kbd>N</kbd> and fill in the connection details. Already use OpenSSH? Import hosts from `~/.ssh/config` instead.
2. **Connect** — select the host in the sidebar, or press <kbd>⌘</kbd> <kbd>P</kbd> and search for it. For a one-time connection, enter `user@host` without saving it first.
3. **Transfer files** — press <kbd>⌘</kbd> <kbd>J</kbd> to open the two-pane file browser, then drag files between your computer and the server.

On Windows and Linux, use <kbd>Ctrl</kbd> wherever this page shows <kbd>⌘</kbd>.

## Built for day-to-day operations

- **Terminal:** GPU-accelerated rendering, concurrent sessions, split panes, session workspace restore, keepalives, one-click reconnect, history autocomplete, scrollback search, and broadcast input.
- **Hosts and access:** Nested groups, reusable credentials, Ed25519/RSA/ECDSA key generation, host-key verification, SSH agent support, ProxyJump chains, and per-host startup commands.
- **SFTP:** Local/remote panes, directory transfer, bookmarks, permissions, conflict handling, cancel/retry controls, transfer history, and an editor that saves directly to the server.
- **Automation:** Command snippets support `{{variable}}` placeholders and can run across selected hosts with separate results.
- **Networking:** Create `-L`, `-R`, or `-D` tunnels, control them from the app, and optionally start them automatically.

## Optional AI assistant

Configure Anthropic or an OpenAI-compatible service under **Settings → AI**, then press <kbd>⌘</kbd> <kbd>L</kbd>. The assistant can list hosts, open connections, read terminal output, and propose or run commands.

Operations require confirmation by default. Autonomous mode is an explicit opt-in; hosts marked as approval-required remain manually gated.

## Optional sync and backup

Under **Settings → Sync**, connect GitHub Gist, Google Drive, OneDrive, WebDAV, or S3. Set a sync passphrase, then use the same passphrase on another device to restore hosts, credentials, snippets, tunnels, bookmarks, and interface preferences.

You can also export and restore an encrypted backup without connecting a cloud provider.

> [!IMPORTANT]
> Sageport cannot recover a lost sync or backup passphrase.

## Security

- Data is stored locally in SQLite. Sensitive values — including passwords, private keys, API keys, and sync credentials — are encrypted with AES-256-GCM; the master key is kept separately in the operating system credential store.
- Sync and backup keys are derived from your passphrase with Argon2id. Only AES-256-GCM encrypted data leaves the device.
- New SSH host keys must be verified. AI actions require approval unless you explicitly enable Autonomous mode.
- Cloud sync and AI are optional; normal SSH, SFTP, monitoring, tunnels, and snippets do not require a Sageport cloud service.

## License

[GPL-3.0-only](LICENSE)
