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
use crate::domain::{now, Group, Host, Identity, PortForward, SftpBookmark, Snippet, SshKey};
use crate::error::AppResult;
use crate::repository::settings_repo;

const EXCLUDED_SETTINGS_PREFIXES: &[&str] = &["sync.", "update."];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub exported_at: String,
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub hosts: Vec<Host>,
    #[serde(default)]
    pub identities: Vec<Identity>,
    #[serde(default)]
    pub keys: Vec<SshKey>,
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    #[serde(default)]
    pub settings: Vec<SettingEntry>,
    #[serde(default)]
    pub port_forwards: Vec<PortForward>,
    #[serde(default)]
    pub sftp_bookmarks: Vec<SftpBookmark>,
}

impl VaultSnapshot {
    pub fn content_fingerprint(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(
            self.groups.len()
                + self.hosts.len()
                + self.identities.len()
                + self.keys.len()
                + self.snippets.len()
                + self.settings.len()
                + self.port_forwards.len()
                + self.sftp_bookmarks.len(),
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
        out.extend(
            self.port_forwards
                .iter()
                .map(|f| format!("f:{}:{}", f.id, f.revision)),
        );
        out.extend(
            self.sftp_bookmarks
                .iter()
                .map(|b| format!("b:{}:{}", b.id, b.revision)),
        );
        out.sort_unstable();
        out
    }
}

pub async fn export_snapshot(pool: &SqlitePool) -> AppResult<VaultSnapshot> {
    let groups = fetch_all::<Group>(pool, "groups").await?;
    let hosts = fetch_all::<Host>(pool, "hosts").await?;
    let identities = fetch_all::<Identity>(pool, "identities").await?;
    let keys = fetch_all::<SshKey>(pool, "keys").await?;
    let snippets = fetch_all::<Snippet>(pool, "snippets").await?;
    let port_forwards = fetch_all::<PortForward>(pool, "port_forwards").await?;
    let sftp_bookmarks = fetch_all::<SftpBookmark>(pool, "sftp_bookmarks").await?;
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
        exported_at: now(),
        groups,
        hosts,
        identities,
        keys,
        snippets,
        settings,
        port_forwards,
        sftp_bookmarks,
    })
}

pub async fn import_snapshot(pool: &SqlitePool, snapshot: &VaultSnapshot) -> AppResult<()> {
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
    for f in &snapshot.port_forwards {
        merge_forward(&mut *tx, f).await?;
    }
    for b in &snapshot.sftp_bookmarks {
        merge_bookmark(&mut *tx, b).await?;
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

pub fn decrypt_snapshot(
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<VaultSnapshot> {
    let bytes = crypto::decrypt(envelope, passphrase)?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn import_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<VaultSnapshot> {
    let snapshot = decrypt_snapshot(envelope, passphrase)?;
    import_snapshot(pool, &snapshot).await?;
    Ok(snapshot)
}

pub async fn restore_snapshot(pool: &SqlitePool, snapshot: &VaultSnapshot) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM sftp_bookmarks")
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM port_forwards")
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

    delete_settings_excluding_prefixes(&mut *tx, EXCLUDED_SETTINGS_PREFIXES).await?;

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
    for f in &snapshot.port_forwards {
        merge_forward(&mut *tx, f).await?;
    }
    for b in &snapshot.sftp_bookmarks {
        merge_bookmark(&mut *tx, b).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(&mut *tx, entry).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn restore_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<()> {
    let snapshot = decrypt_snapshot(envelope, passphrase)?;
    restore_snapshot(pool, &snapshot).await
}

pub fn write_envelope_file(path: &Path, envelope: &EncryptedEnvelope) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(envelope)?)?;
    Ok(())
}

pub fn read_envelope_file(path: &Path) -> AppResult<EncryptedEnvelope> {
    let bytes = std::fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn fetch_all<T>(pool: &SqlitePool, table: &str) -> AppResult<Vec<T>>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
{
    let sql = format!("SELECT * FROM {table}");
    Ok(sqlx::query_as::<_, T>(&sql).fetch_all(pool).await?)
}

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

async fn merge_bookmark<'e, E>(executor: E, b: &SftpBookmark) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO sftp_bookmarks
           (id, host_id, label, path, sort_order, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           host_id = excluded.host_id, label = excluded.label, path = excluded.path,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > sftp_bookmarks.updated_at",
    )
    .bind(&b.id).bind(&b.host_id).bind(&b.label).bind(&b.path).bind(b.sort_order)
    .bind(&b.created_at).bind(&b.updated_at).bind(&b.deleted_at).bind(b.revision)
    .execute(executor).await?;
    Ok(())
}

async fn merge_forward<'e, E>(executor: E, f: &PortForward) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO port_forwards
           (id, host_id, label, kind, bind_host, bind_port, target_host, target_port,
            auto_start, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           host_id = excluded.host_id, label = excluded.label, kind = excluded.kind,
           bind_host = excluded.bind_host, bind_port = excluded.bind_port,
           target_host = excluded.target_host, target_port = excluded.target_port,
           auto_start = excluded.auto_start,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > port_forwards.updated_at",
    )
    .bind(&f.id).bind(&f.host_id).bind(&f.label).bind(&f.kind)
    .bind(&f.bind_host).bind(f.bind_port).bind(&f.target_host).bind(f.target_port)
    .bind(f.auto_start).bind(&f.created_at).bind(&f.updated_at).bind(&f.deleted_at).bind(f.revision)
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
            os_hint, color, notes, jump_host_id, startup_command, password, last_used_at,
            created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label, address = excluded.address, port = excluded.port,
           group_id = excluded.group_id, identity_id = excluded.identity_id, username = excluded.username,
           auth_type = excluded.auth_type, key_id = excluded.key_id, os_hint = excluded.os_hint,
           color = excluded.color, notes = excluded.notes,
           jump_host_id = excluded.jump_host_id, startup_command = excluded.startup_command,
           password = excluded.password, last_used_at = excluded.last_used_at,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > hosts.updated_at",
    )
    .bind(&h.id).bind(&h.label).bind(&h.address).bind(h.port).bind(&h.group_id)
    .bind(&h.identity_id).bind(&h.username).bind(&h.auth_type).bind(&h.key_id)
    .bind(&h.os_hint).bind(&h.color).bind(&h.notes)
    .bind(&h.jump_host_id).bind(&h.startup_command)
    .bind(&h.password).bind(&h.last_used_at)
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
