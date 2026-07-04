//! Sync foundation.
//!
//! Everything the UI owns is serialized into a [`VaultSnapshot`], sealed with
//! the user's passphrase ([`crate::crypto`]), and shipped as an opaque
//! [`EncryptedEnvelope`]. Two consumers exist for that envelope:
//!
//! * a [`provider::SyncProvider`] — one of five remote backends (GitHub
//!   Gist, Google Drive, OneDrive, WebDAV, S3-compatible), exactly one of
//!   which is connected at a time;
//! * the file helpers below — write/read the vault to a local path for the
//!   standalone one-shot backup/restore feature.
//!
//! Importing always performs a last-write-wins merge keyed on `updated_at`,
//! so every transport drives the exact same reconciliation path.

mod gdrive;
mod gist;
pub mod oauth;
mod onedrive;
mod provider;
mod s3;
mod webdav;

pub use provider::{make_provider, ProviderConfig, ProviderKind, SyncVersion};

use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::crypto::{self, EncryptedEnvelope};
use crate::domain::{now, Group, Host, Identity, Snippet, SshKey};
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;

const SNAPSHOT_VERSION: u32 = 2;

/// Setting keys under these prefixes never travel in a vault snapshot — they
/// are per-device, not user data:
/// * `sync.` — the sync connection itself (token, gist id, passphrase,
///   last-synced marker). Backing it up would let a restore on one device
///   silently repoint another device's sync connection.
/// * `update.` — cached update-check results (last checked time, last known
///   version). Restoring these on another device would show that device
///   stale or wrong update info for its own binary.
const EXCLUDED_SETTINGS_PREFIXES: &[&str] = &["sync.", "update."];

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
/// every app setting except per-device state (see
/// [`EXCLUDED_SETTINGS_PREFIXES`]).
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

impl VaultSnapshot {
    /// Content fingerprint independent of `exported_at` (which changes on
    /// every export even when nothing else did). Two snapshots with the same
    /// fingerprint carry identical data — pushing one over the other would
    /// only add a byte-different but semantically redundant backup revision.
    /// `(id, revision)` is enough per entity table since every mutation bumps
    /// `revision`; settings have no revision counter so `updated_at` stands in.
    pub fn content_fingerprint(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(
            self.groups.len()
                + self.hosts.len()
                + self.identities.len()
                + self.keys.len()
                + self.snippets.len()
                + self.settings.len(),
        );
        out.extend(
            self.groups
                .iter()
                .map(|g| format!("g:{}:{}", g.id, g.revision)),
        );
        out.extend(
            self.hosts
                .iter()
                .map(|h| format!("h:{}:{}", h.id, h.revision)),
        );
        out.extend(
            self.identities
                .iter()
                .map(|i| format!("i:{}:{}", i.id, i.revision)),
        );
        out.extend(
            self.keys
                .iter()
                .map(|k| format!("k:{}:{}", k.id, k.revision)),
        );
        out.extend(
            self.snippets
                .iter()
                .map(|s| format!("s:{}:{}", s.id, s.revision)),
        );
        out.extend(
            self.settings
                .iter()
                .map(|e| format!("e:{}:{}", e.key, e.updated_at)),
        );
        out.sort_unstable();
        out
    }
}

/// Collect every row (including tombstones). Secrets are columns on the rows.
pub async fn export_snapshot(pool: &SqlitePool) -> AppResult<VaultSnapshot> {
    let groups = fetch_all::<Group>(pool, "groups").await?;
    let hosts = fetch_all::<Host>(pool, "hosts").await?;
    let identities = fetch_all::<Identity>(pool, "identities").await?;
    let keys = fetch_all::<SshKey>(pool, "keys").await?;
    let snippets = fetch_all::<Snippet>(pool, "snippets").await?;
    let settings = settings_repo::all_excluding_prefixes(pool, EXCLUDED_SETTINGS_PREFIXES)
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
    validate_snapshot(snapshot)?;
    let mut tx = pool.begin().await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    for g in &snapshot.groups {
        merge_group(&mut *tx, g).await?;
    }
    for i in &snapshot.identities {
        merge_identity(&mut *tx, i).await?;
    }
    for k in &snapshot.keys {
        merge_key(&mut *tx, k).await?;
    }
    for h in &snapshot.hosts {
        merge_host(&mut *tx, h).await?;
    }
    for s in &snapshot.snippets {
        merge_snippet(&mut *tx, s).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(&mut *tx, entry).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn export_encrypted(pool: &SqlitePool, passphrase: &str) -> AppResult<EncryptedEnvelope> {
    let snapshot = export_snapshot(pool).await?;
    let bytes = serde_json::to_vec(&snapshot)?;
    crypto::encrypt(&bytes, passphrase)
}

/// Decrypt, merge, and hand back the remote snapshot so the caller can
/// compare its [`VaultSnapshot::content_fingerprint`] against a fresh local
/// export before deciding whether pushing again would be redundant.
pub async fn import_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<VaultSnapshot> {
    let bytes = crypto::decrypt(envelope, passphrase)?;
    let snapshot: VaultSnapshot = serde_json::from_slice(&bytes)?;
    import_snapshot(pool, &snapshot).await?;
    Ok(snapshot)
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
    validate_snapshot(snapshot)?;
    let mut tx = pool.begin().await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM hosts").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM identities")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM keys").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM groups").execute(&mut *tx).await?;
    sqlx::query("DELETE FROM snippets")
        .execute(&mut *tx)
        .await?;
    // Never touch per-device state (sync connection, cached update info) —
    // rolling back to an old backup must not repoint or disconnect sync, or
    // clobber this device's own update-check cache.
    delete_settings_excluding_prefixes(&mut *tx, EXCLUDED_SETTINGS_PREFIXES).await?;

    // The tables above are now empty, so every insert below always takes the
    // plain-insert branch of the upsert (no row can conflict).
    for g in &snapshot.groups {
        merge_group(&mut *tx, g).await?;
    }
    for k in &snapshot.keys {
        merge_key(&mut *tx, k).await?;
    }
    for i in &snapshot.identities {
        merge_identity(&mut *tx, i).await?;
    }
    for h in &snapshot.hosts {
        merge_host(&mut *tx, h).await?;
    }
    for s in &snapshot.snippets {
        merge_snippet(&mut *tx, s).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(&mut *tx, entry).await?;
    }
    tx.commit().await?;
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

fn validate_snapshot(snapshot: &VaultSnapshot) -> AppResult<()> {
    if snapshot.version == 0 || snapshot.version > SNAPSHOT_VERSION {
        return Err(AppError::Invalid(format!(
            "unsupported vault version {}",
            snapshot.version
        )));
    }
    Ok(())
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

async fn merge_group<'e, E>(executor: E, g: &Group) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
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
    .execute(executor).await?;
    Ok(())
}

async fn merge_identity<'e, E>(executor: E, i: &Identity) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
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
    .execute(executor).await?;
    Ok(())
}

async fn merge_key<'e, E>(executor: E, k: &SshKey) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
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
    .execute(executor).await?;
    Ok(())
}

async fn merge_host<'e, E>(executor: E, h: &Host) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
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
    .execute(executor).await?;
    Ok(())
}

async fn merge_snippet<'e, E>(executor: E, s: &Snippet) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
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
    .execute(executor).await?;
    Ok(())
}

async fn merge_setting<'e, E>(executor: E, entry: &SettingEntry) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    // Defense in depth: even if a snapshot somehow carried a `sync.*` or
    // `update.*` key (old export, hand-edited file, ...) never let it
    // overwrite this device's own sync connection or update-check cache.
    if EXCLUDED_SETTINGS_PREFIXES
        .iter()
        .any(|prefix| entry.key.starts_with(prefix))
    {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE excluded.updated_at > settings.updated_at",
    )
    .bind(&entry.key)
    .bind(&entry.value)
    .bind(&entry.updated_at)
    .execute(executor)
    .await?;
    Ok(())
}

async fn delete_settings_excluding_prefixes<'e, E>(executor: E, prefixes: &[&str]) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    if prefixes.is_empty() {
        sqlx::query("DELETE FROM settings")
            .execute(executor)
            .await?;
        return Ok(());
    }

    let clause = prefixes
        .iter()
        .map(|_| "key NOT LIKE ?")
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!("DELETE FROM settings WHERE {clause}");
    let mut query = sqlx::query(&sql);
    for prefix in prefixes {
        query = query.bind(format!("{prefix}%"));
    }
    query.execute(executor).await?;
    Ok(())
}
