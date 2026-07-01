-- Sageport initial schema.
--
-- Every user-owned entity carries sync-ready metadata:
--   id          stable UUID (so rows can be reconciled across devices)
--   created_at  RFC3339 UTC
--   updated_at  RFC3339 UTC  (last-write-wins ordering key)
--   deleted_at  RFC3339 UTC  (soft delete / tombstone for sync)
--   revision    monotonically increasing local revision counter
-- Secrets (passwords, private keys, passphrases) are stored inline as plain
-- columns, exactly like any other field. There is no OS keychain dependency, so
-- the app never triggers a system credential prompt. The database file is the
-- single source of truth and should be protected by filesystem permissions.

PRAGMA foreign_keys = ON;

CREATE TABLE groups (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES groups (id) ON DELETE SET NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE keys (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  public_key  TEXT,
  private_key TEXT,                 -- PEM/OpenSSH private key material
  passphrase  TEXT,                 -- passphrase protecting the private key
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE identities (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  username    TEXT NOT NULL,
  -- 'password' | 'key' | 'agent'
  auth_type   TEXT NOT NULL DEFAULT 'password',
  key_id      TEXT REFERENCES keys (id) ON DELETE SET NULL,
  password    TEXT,                 -- inline password, used for password auth
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE hosts (
  id           TEXT PRIMARY KEY NOT NULL,
  label        TEXT NOT NULL,
  address      TEXT NOT NULL,
  port         INTEGER NOT NULL DEFAULT 22,
  group_id     TEXT REFERENCES groups (id) ON DELETE SET NULL,
  identity_id  TEXT REFERENCES identities (id) ON DELETE SET NULL,
  -- Inline credentials, used when identity_id is null:
  username     TEXT,
  auth_type    TEXT,                 -- 'password' | 'key' | 'agent'
  key_id       TEXT REFERENCES keys (id) ON DELETE SET NULL,
  password     TEXT,                 -- inline password, used for password auth
  os_hint      TEXT,                 -- 'linux' | 'macos' | 'windows' | ...
  color        TEXT,                 -- accent color tag for the UI
  notes        TEXT,
  last_used_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  revision     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE snippets (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  revision    INTEGER NOT NULL DEFAULT 1
);

-- Simple key/value store for app + sync preferences (non-secret).
CREATE TABLE settings (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_hosts_group ON hosts (group_id);
CREATE INDEX idx_hosts_updated ON hosts (updated_at);
CREATE INDEX idx_groups_parent ON groups (parent_id);
CREATE INDEX idx_identities_updated ON identities (updated_at);
CREATE INDEX idx_snippets_updated ON snippets (updated_at);
