<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**A modern, ops-focused SSH client with a built-in AI assistant**

Connect, transfer, and troubleshoot in one window, with your data encrypted and yours alone.

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Features](#features) · [Getting Started](#getting-started) · [Data & Security](#data--security)

</div>

---

## Why Sageport

Terminal, SFTP file management, command snippets, and SSH key management live in a single interface, so you stop juggling separate tools for routine ops work.

An AI assistant sits alongside your sessions and reads their output to help diagnose errors and suggest commands, but it never acts on its own: any command it wants to run on a server needs your explicit confirmation first.

Hosts, credentials, and snippets sync across devices through an end-to-end encrypted private GitHub Gist, so there's no account to register and no third-party server that ever sees your unencrypted data.

The whole thing is built on Tauri, which keeps the installer small, startup quick, and memory footprint low.

## Features

### Terminal

Sessions render through xterm.js with GPU acceleration, so output stays smooth even under heavy load.

You can run multiple sessions at once and switch between them instantly, with in-terminal search, clickable links, and full Unicode support built in.

### Host Management

Hosts are organized into groups, and credentials — passwords, keys, identities — are decoupled from hosts so the same credential can be reused across many of them.

A built-in SSH key manager generates or imports Ed25519, RSA, and ECDSA keys in standard OpenSSH format, with optional passphrase protection.

### SFTP File Transfer

Browse, upload, and download remote files directly from a session.

Folders are automatically archived and compressed in transit, keeping transfers fast even when thousands of small files are involved.

### Command Snippets

Save commands you use often and send them to the active session with one click.

Snippets sync across devices along with the rest of your data.

### AI Assistant

Bring your own API key: Sageport works with Anthropic and any OpenAI-compatible endpoint, with a configurable base URL and model.

The assistant can list your sessions and read terminal output to troubleshoot with full context, but every remote command it proposes always prompts for confirmation, so you review or decline each one before it runs.

### Sync & Backup

A single passphrase encrypts all your data, which then syncs across devices via a private GitHub Gist.

You can also export and import encrypted backup files for offline safekeeping. Conflicts resolve automatically with last-write-wins merging, so there's nothing to sort out by hand.

### Interface

Choose light or dark mode with five accent themes — monochrome, indigo, cyan, forest, and amber.

The app is localized in English and Simplified Chinese, and updates itself automatically.

## Installation

Download the installer for your platform from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| Platform | Package |
| --- | --- |
| macOS | `.dmg` (Apple Silicon / Intel) |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.rpm` / `.AppImage` |

No manual upgrades needed — the app notifies you when a new version is available.

## Getting Started

1. **Add a host.** Click "New Host" in the sidebar, enter the address and port, and choose password or key authentication.
2. **Connect.** Double-click a host to open a terminal session; open as many sessions per host as you need.
3. **Transfer files.** Open the SFTP panel in a session to upload and download files.
4. **Set up the AI assistant (optional).** In Settings, enter your API key (Anthropic or any OpenAI-compatible service) and pick a model.
5. **Enable sync (optional).** In Settings → Sync, provide a GitHub token and a sync passphrase; enter the same passphrase on another device to pull your entire configuration.

## Data & Security

All data lives in a local SQLite database, so nothing requires a cloud service to function.

Sync and backups derive a key from your passphrase using Argon2 and encrypt it with AES-256-GCM; only ciphertext ever reaches the Gist, and your passphrase never leaves the device. **If you lose the passphrase, the data cannot be recovered, so keep it safe.**

Every remote command the AI assistant initiates runs only after you approve it, and the entire codebase is open for audit.

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
