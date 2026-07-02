<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**A modern, ops-focused SSH client with a built-in AI assistant**

Connect, transfer, and troubleshoot — all in one window. Your data stays encrypted and yours alone.

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Features](#features) · [Getting Started](#getting-started) · [Data & Security](#data--security)

</div>

---

## Why Sageport

- **One workspace for everything** — Terminal, SFTP file management, command snippets, and SSH key management in a single interface. No more juggling separate tools.
- **An AI assistant that sees your terminal** — The assistant reads your session output to help diagnose errors and suggest commands. Any command it wants to run on a server requires your explicit confirmation first.
- **Seamless multi-device sync, zero backend** — Hosts, credentials, and snippets sync through an end-to-end encrypted private GitHub Gist. No account to register, no third-party server ever touches your data.
- **Light and fast** — Built on Tauri: small installer, quick startup, low memory footprint.

## Features

### Terminal

- GPU-accelerated rendering via xterm.js — smooth even under heavy output
- Multiple concurrent sessions with instant switching
- In-terminal search, clickable links, full Unicode support

### Host Management

- Organize hosts into groups; credentials (passwords, keys, identities) are decoupled from hosts and reusable
- Built-in SSH key manager: generate or import Ed25519, RSA, and ECDSA keys in standard OpenSSH format, with optional passphrase protection

### SFTP File Transfer

- Browse, upload, and download remote files right from a session
- Folders are automatically archived and compressed in transit — fast even with thousands of small files

### Command Snippets

- Save frequently used commands and send them to the active session with one click
- Synced across devices along with the rest of your data

### AI Assistant

- Bring your own API key — works with Anthropic and any OpenAI-compatible endpoint, with a configurable base URL and model
- The assistant can list sessions and read terminal output to troubleshoot with full context
- Every remote command **always prompts for confirmation** — review or decline each one before it runs

### Sync & Backup

- One passphrase encrypts all your data, synced across devices via a private GitHub Gist
- Export and import encrypted backup files for offline safekeeping
- Conflicts resolve automatically with last-write-wins merging — nothing to sort out by hand

### Interface

- Light and dark modes with five accent themes: monochrome, indigo, cyan, forest, and amber
- English and Simplified Chinese localization
- Automatic in-app updates

## Installation

Download the installer for your platform from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` (Apple Silicon / Intel) |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

No manual upgrades needed — the app notifies you when a new version is available.

## Getting Started

1. **Add a host** — Click "New Host" in the sidebar, enter the address and port, and choose password or key authentication.
2. **Connect** — Double-click a host to open a terminal session. Open as many sessions per host as you need.
3. **Transfer files** — Open the SFTP panel in a session to upload and download files.
4. **Set up the AI assistant (optional)** — In Settings, enter your API key (Anthropic or any OpenAI-compatible service) and pick a model.
5. **Enable sync (optional)** — In Settings → Sync, provide a GitHub token and a sync passphrase. Enter the same passphrase on another device to pull your entire configuration.

## Data & Security

- **Local-first**: All data lives in a local SQLite database. No cloud service required.
- **End-to-end encryption**: Sync and backups derive a key from your passphrase (Argon2) and encrypt with AES-256-GCM. Only ciphertext reaches the Gist; your passphrase never leaves the device. **If you lose the passphrase, the data cannot be recovered — keep it safe.**
- **Commands under your control**: Every remote command initiated by the AI assistant runs only after you approve it.
- **Open source**: The entire codebase is open for audit.

## Development

Tech stack: Tauri 2 + Rust · React 19 + TypeScript · Tailwind CSS

```bash
# Prerequisites: Rust, Node.js, pnpm
pnpm install

# Development mode
pnpm tauri dev

# Build installers
pnpm tauri build
```

Useful scripts: `pnpm lint` (linting), `pnpm typecheck` (type checking), `pnpm format` (formatting).

Issues and pull requests are welcome.

## License

[GPL-3.0](LICENSE)
