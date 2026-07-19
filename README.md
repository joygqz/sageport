<div align="center">

<img src="public/app-icon.png" alt="Sageport" width="96" height="96" />

# Sageport

**Connect, transfer, monitor, and operate your servers from one desktop app.**

A free, open-source SSH workbench for macOS, Windows, and Linux.

[![Latest release](https://img.shields.io/github/v/release/joygqz/sageport)](https://github.com/joygqz/sageport/releases/latest)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://tauri.app)

English · [简体中文](README.zh-CN.md)

[Download](https://github.com/joygqz/sageport/releases/latest) · [Get started](#get-started-in-3-minutes) · [Highlights](#highlights)

</div>

![Sageport workbench](docs/screenshot.png)

Sageport replaces the usual pile of terminal windows, transfer tools, key managers, and command notes. It speaks plain SSH — **nothing to install on your servers, no account to create**, and everything stays on your device.

## Highlights

- **A terminal that keeps up.** Tabs, split panes, one-click reconnect, scrollback search, command autocomplete — and broadcast typing to many servers at once.
- **Files without friction.** Drag and drop between your computer and the server in a two-pane browser, or edit remote files and save them straight back.
- **Server health at a glance.** Live CPU, memory, disk, and network — no agent to deploy.
- **All your hosts, organized.** Groups, shared logins, jump hosts for servers behind a bastion, and one-click import of your existing SSH hosts.
- **Repeat without retyping.** Save commands as snippets with fill-in variables, then run them across many servers with per-host results.
- **Private services, one click away.** Port forwarding you can start, stop, and auto-launch from the app — including through jump hosts.
- **An AI assistant that asks first.** Bring your own AI provider; the assistant can see your workbench and suggest or run commands, but every action waits for your approval unless you opt out.
- **Take it everywhere.** Optional encrypted sync through GitHub, Google Drive, OneDrive, WebDAV, or S3 — or a simple encrypted backup file.

It all lives in a familiar VS Code-style workspace with a command palette, keyboard shortcuts, light and dark themes, and an English or 简体中文 interface.

## Download

Grab the installer for your computer from the [latest release](https://github.com/joygqz/sageport/releases/latest):

| System                          | Download              |
| ------------------------------- | --------------------- |
| macOS (Apple Silicon and Intel) | Universal `.dmg`      |
| Windows (64-bit)                | `.exe` installer      |
| Linux (64-bit)                  | `.AppImage` or `.deb` |

Sageport keeps itself up to date — new versions install right from the app.

## Get started in 3 minutes

You'll need your server's address, username, and a password or private key.

1. **Add a server** — press <kbd>⌘</kbd> <kbd>N</kbd> and fill in the details, or import your existing SSH hosts.
2. **Connect** — click the host in the sidebar, or press <kbd>⌘</kbd> <kbd>P</kbd> and type its name. In a hurry? Enter `user@host` to connect without saving anything.
3. **Move files** — press <kbd>⌘</kbd> <kbd>J</kbd> and drag files between your computer and the server.

On Windows and Linux, use <kbd>Ctrl</kbd> wherever this page shows <kbd>⌘</kbd>.

## Your data stays yours

- Everything is stored on your device. There is no Sageport cloud service and no account.
- Passwords, keys, and other secrets are always encrypted — on disk, in backups, and during sync.
- Sync and backups are locked with a passphrase only you know. Sageport cannot read them — and cannot recover a lost passphrase, so keep it safe.
- Connecting to an unfamiliar server always asks you to verify it first, and AI actions never run without your say-so unless you explicitly allow it.

## License

[GPL-3.0-only](LICENSE)
