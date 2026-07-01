//! Sync foundation.
//!
//! Everything the UI owns is serialized into a [`VaultSnapshot`], sealed with
//! the user's passphrase ([`crate::crypto`]), and shipped as an opaque
//! [`EncryptedEnvelope`]. Two transports consume that envelope:
//!
//! * [`GistClient`] — pushes/pulls the vault to a secret GitHub Gist for
//!   zero-backend multi-device sync.
//! * the file helpers below — write/read the vault to a local path for manual
//!   backup and restore.
//!
//! Importing always performs a last-write-wins merge keyed on `updated_at`, so
//! both transports drive the exact same reconciliation path.

mod gist;

pub use gist::{GistClient, GistVersion};

use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::crypto::{self, EncryptedEnvelope};
use crate::domain::{now, Group, Host, Identity, Snippet, SshKey};
use crate::error::AppResult;
use crate::repository::settings_repo;

const SNAPSHOT_VERSION: u32 = 2;

/// Setting keys under this prefix (the sync connection itself — token, gist
/// id, passphrase, last-synced marker) never travel in a vault snapshot: they
/// are per-device, and backing them up would let a restore on one device
/// silently repoint another device's sync connection.
const EXCLUDED_SETTINGS_PREFIX: &str = "sync.";

/// One row of the app's key/value settings (AI config, and anything else
/// added later) carried by a vault snapshot, LWW-merged just like the entity
/// tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

/// Full, device-independent snapshot of the user's data. Secrets travel inline
/// on their rows (passwords, private keys, passphrases), so a snapshot is
/// everything another device needs to make the hosts usable. Also carries
/// every app setting except the sync connection itself (see
/// [`EXCLUDED_SETTINGS_PREFIX`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub version: u32,
    pub exported_at: String,
    pub groups: Vec<Group>,
    pub hosts: Vec<Host>,
    pub identities: Vec<Identity>,
    pub keys: Vec<SshKey>,
    pub snippets: Vec<Snippet>,
    #[serde(default)]
    pub settings: Vec<SettingEntry>,
}

/// Collect every row (including tombstones). Secrets are columns on the rows.
pub async fn export_snapshot(pool: &SqlitePool) -> AppResult<VaultSnapshot> {
    let groups = fetch_all::<Group>(pool, "groups").await?;
    let hosts = fetch_all::<Host>(pool, "hosts").await?;
    let identities = fetch_all::<Identity>(pool, "identities").await?;
    let keys = fetch_all::<SshKey>(pool, "keys").await?;
    let snippets = fetch_all::<Snippet>(pool, "snippets").await?;
    let settings = settings_repo::all_excluding_prefix(pool, EXCLUDED_SETTINGS_PREFIX)
        .await?
        .into_iter()
        .map(|(key, value, updated_at)| SettingEntry {
            key,
            value,
            updated_at,
        })
        .collect();

    Ok(VaultSnapshot {
        version: SNAPSHOT_VERSION,
        exported_at: now(),
        groups,
        hosts,
        identities,
        keys,
        snippets,
        settings,
    })
}

/// Last-write-wins merge of an incoming snapshot into the local database.
pub async fn import_snapshot(pool: &SqlitePool, snapshot: &VaultSnapshot) -> AppResult<()> {
    for g in &snapshot.groups {
        merge_group(pool, g).await?;
    }
    for i in &snapshot.identities {
        merge_identity(pool, i).await?;
    }
    for k in &snapshot.keys {
        merge_key(pool, k).await?;
    }
    for h in &snapshot.hosts {
        merge_host(pool, h).await?;
    }
    for s in &snapshot.snippets {
        merge_snippet(pool, s).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(pool, entry).await?;
    }
    Ok(())
}

pub async fn export_encrypted(pool: &SqlitePool, passphrase: &str) -> AppResult<EncryptedEnvelope> {
    let snapshot = export_snapshot(pool).await?;
    let bytes = serde_json::to_vec(&snapshot)?;
    crypto::encrypt(&bytes, passphrase)
}

pub async fn import_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<()> {
    let bytes = crypto::decrypt(envelope, passphrase)?;
    let snapshot: VaultSnapshot = serde_json::from_slice(&bytes)?;
    import_snapshot(pool, &snapshot).await
}

/// Point-in-time restore: unlike [`import_snapshot`], which only ever merges
/// (last-write-wins) and can never delete or "go back" past what's already
/// local, this replaces every row wholesale with the chosen backup. Used when
/// the user explicitly picks an older gist revision to roll back to — the
/// whole point is to override rows that look newer locally.
///
/// Children are cleared before parents so no FK ever dangles mid-restore, and
/// parents are (re)inserted before children so every foreign key resolves.
pub async fn restore_snapshot(pool: &SqlitePool, snapshot: &VaultSnapshot) -> AppResult<()> {
    sqlx::query("DELETE FROM hosts").execute(pool).await?;
    sqlx::query("DELETE FROM identities").execute(pool).await?;
    sqlx::query("DELETE FROM keys").execute(pool).await?;
    sqlx::query("DELETE FROM groups").execute(pool).await?;
    sqlx::query("DELETE FROM snippets").execute(pool).await?;
    // Never touch the sync connection itself (token/gist id/passphrase) —
    // rolling back to an old backup must not repoint or disconnect sync on
    // this device.
    settings_repo::delete_all_excluding_prefix(pool, EXCLUDED_SETTINGS_PREFIX).await?;

    // The tables above are now empty, so every insert below always takes the
    // plain-insert branch of the upsert (no row can conflict).
    for g in &snapshot.groups {
        merge_group(pool, g).await?;
    }
    for k in &snapshot.keys {
        merge_key(pool, k).await?;
    }
    for i in &snapshot.identities {
        merge_identity(pool, i).await?;
    }
    for h in &snapshot.hosts {
        merge_host(pool, h).await?;
    }
    for s in &snapshot.snippets {
        merge_snippet(pool, s).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(pool, entry).await?;
    }
    Ok(())
}

/// Decrypt `envelope` with `passphrase` and [`restore_snapshot`] it.
pub async fn restore_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<()> {
    let bytes = crypto::decrypt(envelope, passphrase)?;
    let snapshot: VaultSnapshot = serde_json::from_slice(&bytes)?;
    restore_snapshot(pool, &snapshot).await
}

/// Write an encrypted envelope to a local path (pretty JSON, so it stays
/// inspectable). Used by the manual file export/backup path.
pub fn write_envelope_file(path: &Path, envelope: &EncryptedEnvelope) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(envelope)?)?;
    Ok(())
}

/// Read an encrypted envelope previously written by [`write_envelope_file`].
pub fn read_envelope_file(path: &Path) -> AppResult<EncryptedEnvelope> {
    let bytes = std::fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn fetch_all<T>(pool: &SqlitePool, table: &str) -> AppResult<Vec<T>>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
{
    // Table name is a fixed internal constant, never user input.
    let sql = format!("SELECT * FROM {table}");
    Ok(sqlx::query_as::<_, T>(&sql).fetch_all(pool).await?)
}

// --- Per-table LWW upserts (only overwrite when the incoming row is newer) ---

async fn merge_group(pool: &SqlitePool, g: &Group) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO groups (id, name, parent_id, sort_order, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, parent_id = excluded.parent_id, sort_order = excluded.sort_order,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > groups.updated_at",
    )
    .bind(&g.id).bind(&g.name).bind(&g.parent_id).bind(g.sort_order)
    .bind(&g.created_at).bind(&g.updated_at).bind(&g.deleted_at).bind(g.revision)
    .execute(pool).await?;
    Ok(())
}

async fn merge_identity(pool: &SqlitePool, i: &Identity) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO identities (id, name, username, auth_type, key_id, password, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, username = excluded.username, auth_type = excluded.auth_type,
           key_id = excluded.key_id, password = excluded.password, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > identities.updated_at",
    )
    .bind(&i.id).bind(&i.name).bind(&i.username).bind(&i.auth_type).bind(&i.key_id).bind(&i.password)
    .bind(&i.created_at).bind(&i.updated_at).bind(&i.deleted_at).bind(i.revision)
    .execute(pool).await?;
    Ok(())
}

async fn merge_key(pool: &SqlitePool, k: &SshKey) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO keys (id, name, public_key, private_key, passphrase, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, public_key = excluded.public_key, private_key = excluded.private_key,
           passphrase = excluded.passphrase, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > keys.updated_at",
    )
    .bind(&k.id).bind(&k.name).bind(&k.public_key).bind(&k.private_key).bind(&k.passphrase)
    .bind(&k.created_at).bind(&k.updated_at).bind(&k.deleted_at).bind(k.revision)
    .execute(pool).await?;
    Ok(())
}

async fn merge_host(pool: &SqlitePool, h: &Host) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO hosts
           (id, label, address, port, group_id, identity_id, username, auth_type, key_id,
            os_hint, color, notes, password, last_used_at, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label, address = excluded.address, port = excluded.port,
           group_id = excluded.group_id, identity_id = excluded.identity_id, username = excluded.username,
           auth_type = excluded.auth_type, key_id = excluded.key_id, os_hint = excluded.os_hint,
           color = excluded.color, notes = excluded.notes, password = excluded.password,
           last_used_at = excluded.last_used_at,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > hosts.updated_at",
    )
    .bind(&h.id).bind(&h.label).bind(&h.address).bind(h.port).bind(&h.group_id)
    .bind(&h.identity_id).bind(&h.username).bind(&h.auth_type).bind(&h.key_id)
    .bind(&h.os_hint).bind(&h.color).bind(&h.notes).bind(&h.password).bind(&h.last_used_at)
    .bind(&h.created_at).bind(&h.updated_at).bind(&h.deleted_at).bind(h.revision)
    .execute(pool).await?;
    Ok(())
}

async fn merge_snippet(pool: &SqlitePool, s: &Snippet) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO snippets (id, name, command, description, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, command = excluded.command, description = excluded.description,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > snippets.updated_at",
    )
    .bind(&s.id).bind(&s.name).bind(&s.command).bind(&s.description)
    .bind(&s.created_at).bind(&s.updated_at).bind(&s.deleted_at).bind(s.revision)
    .execute(pool).await?;
    Ok(())
}

async fn merge_setting(pool: &SqlitePool, entry: &SettingEntry) -> AppResult<()> {
    // Defense in depth: even if a snapshot somehow carried a `sync.*` key
    // (old export, hand-edited file, ...) never let it overwrite this
    // device's own sync connection.
    if entry.key.starts_with(EXCLUDED_SETTINGS_PREFIX) {
        return Ok(());
    }
    settings_repo::merge(pool, &entry.key, &entry.value, &entry.updated_at).await
}
