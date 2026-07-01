# Sageport

An ops-focused **SSH client with an AI command assistant**, built with Tauri 2.
Local-first storage, an OS-keychain-backed secret vault, and an encrypted
export/import path that doubles as a zero-backend sync foundation. The UI takes
cues from Termius: a host sidebar, tabbed terminals, a command palette, and a
side panel assistant.

## Stack

| Layer         | Choice                                                                |
| ------------- | --------------------------------------------------------------------- |
| Shell         | Tauri 2 (Rust)                                                        |
| Frontend      | React 19 + TypeScript (strict), Vite                                  |
| Styling       | Tailwind CSS v4 (CSS-first design tokens), light/dark/system theming  |
| Components    | Self-owned library over Radix primitives + `class-variance-authority` |
| Data fetching | TanStack Query                                                        |
| Client state  | Zustand                                                               |
| Terminal      | xterm.js (`@xterm/*`)                                                 |
| SSH           | `ssh2` (libssh2, vendored OpenSSL)                                    |
| Persistence   | SQLite via `sqlx` (+ migrations)                                      |
| Secrets       | OS keychain via `keyring`                                             |
| Vault crypto  | Argon2id + AES-256-GCM                                                |
| AI            | Anthropic Messages API (`claude-opus-4-8`) via `reqwest`              |

## Architecture

```
src/                         # React frontend
  app/        providers (QueryClient, Theme, Tooltip)
  components/ ui/ (design system) + layout/ (TitleBar, CommandPalette)
  features/   hosts/ terminal/ credentials/ ai/ settings/  (feature modules)
  lib/        ipc.ts (typed Tauri facade), utils, toast store
  theme/      ThemeProvider + tokens
  types/      models.ts (mirror of Rust domain types)

src-tauri/src/               # Rust backend
  commands/   thin Tauri command handlers
  domain/     models + input payloads
  repository/ SQL per aggregate (hosts, groups, identities, keys, snippets)
  ssh/        thread-per-session manager over ssh2, streamed via events
  secrets/    keychain wrapper (single source of secret naming)
  crypto/     passphrase vault (Argon2id + AES-GCM)
  sync/       SyncProvider trait, LocalFileProvider, LWW snapshot merge
  ai/         Anthropic Messages API client
  db/ state/ error/
  migrations/ 0001_init.sql
```

### Key design decisions

- **Sync-ready from day one.** Every row carries `id` (UUID), `created_at`,
  `updated_at`, `deleted_at` (tombstone), and `revision`. Deletes are soft.
  `sync::import_snapshot` does a last-write-wins merge keyed on `updated_at`, so
  the same code path will drive multi-device sync once a remote `SyncProvider`
  is added (the local file provider already works — point it at a synced folder).
- **Secrets never touch the database.** Passwords, private keys, passphrases and
  the AI API key live in the OS keychain, referenced by entity id.
- **Typed IPC boundary.** All `invoke` calls go through `src/lib/ipc.ts`; the
  TS types in `src/types/models.ts` mirror the Rust `serde` models (camelCase).
- **SSH sessions** run one OS thread each, owning the blocking `ssh2` session and
  bridging to the UI with `ssh://data` / `ssh://status` Tauri events.

## Develop

```bash
pnpm install
pnpm tauri dev      # run the desktop app
```

Useful scripts:

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm build          # frontend production build (tsc + vite)
cargo check         # (in src-tauri/) Rust check
```

## Using the AI assistant

Open **Settings → AI**, paste an Anthropic API key (stored in your keychain),
and pick a model. The side panel (toolbar robot icon) then answers ops
questions, returns commands in code blocks, and can copy them or run them in the
active terminal.

## Roadmap

- Remote `SyncProvider` implementations (self-hosted backend / WebDAV / S3).
- Identities & SSH key management UI (backend + storage already in place).
- Agentic AI mode that reads terminal output and executes multi-step tasks.
- SFTP, port forwarding, known-hosts verification.
