mod gdrive;
mod gist;
pub mod oauth;
mod onedrive;
mod provider;
mod s3;
mod settings_compat;
mod webdav;

pub use provider::{make_provider, ProviderConfig, ProviderKind, SyncProvider, SyncVersion};
pub(crate) use settings_compat::sanitize_general_value;

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::{Executor, Sqlite, SqlitePool};

use crate::crypto::{self, EncryptedEnvelope};
use crate::domain::{now, Group, Host, Identity, PortForward, SftpBookmark, Snippet, SshKey};
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::secrets;

const EXCLUDED_SETTINGS_PREFIXES: &[&str] = &["security.", "sync.", "update."];
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;
const MAX_ENVELOPE_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_RECORDS_PER_KIND: usize = 100_000;
const MAX_SYNC_ID_BYTES: usize = 256;
const MAX_CLOCK_SKEW_HOURS: i64 = 24;

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
        // A revision alone is not globally unique: two devices can both
        // produce revision N with different content. Include the complete
        // record so the winning last-write-wins value is uploaded.
        out.extend(self.groups.iter().map(|value| fingerprint("g", value)));
        out.extend(self.hosts.iter().map(|value| fingerprint("h", value)));
        out.extend(self.identities.iter().map(|value| fingerprint("i", value)));
        out.extend(self.keys.iter().map(|value| fingerprint("k", value)));
        out.extend(self.snippets.iter().map(|value| fingerprint("s", value)));
        out.extend(self.settings.iter().map(|value| fingerprint("e", value)));
        out.extend(
            self.port_forwards
                .iter()
                .map(|value| fingerprint("f", value)),
        );
        out.extend(
            self.sftp_bookmarks
                .iter()
                .map(|value| fingerprint("b", value)),
        );
        out.sort_unstable();
        out
    }
}

fn fingerprint<T: Serialize>(kind: &str, value: &T) -> String {
    format!(
        "{kind}:{}",
        serde_json::to_string(value).expect("vault records are JSON serializable")
    )
}

pub async fn export_snapshot(pool: &SqlitePool) -> AppResult<VaultSnapshot> {
    // Keep every table in one SQLite read transaction. Reading through the
    // pool independently can mix revisions from before and after a concurrent
    // mutation, producing an encrypted backup that never existed locally.
    let mut tx = pool.begin().await?;
    let groups = fetch_all::<Group, _>(&mut *tx, "groups").await?;
    let hosts = fetch_all::<Host, _>(&mut *tx, "hosts")
        .await?
        .into_iter()
        .map(secrets::open_host)
        .collect::<AppResult<Vec<_>>>()?;
    let identities = fetch_all::<Identity, _>(&mut *tx, "identities")
        .await?
        .into_iter()
        .map(secrets::open_identity)
        .collect::<AppResult<Vec<_>>>()?;
    let keys = fetch_all::<SshKey, _>(&mut *tx, "keys")
        .await?
        .into_iter()
        .map(secrets::open_key)
        .collect::<AppResult<Vec<_>>>()?;
    let snippets = fetch_all::<Snippet, _>(&mut *tx, "snippets").await?;
    let port_forwards = fetch_all::<PortForward, _>(&mut *tx, "port_forwards").await?;
    let sftp_bookmarks = fetch_all::<SftpBookmark, _>(&mut *tx, "sftp_bookmarks").await?;
    let settings = settings_repo::all_excluding_prefixes(&mut *tx, EXCLUDED_SETTINGS_PREFIXES)
        .await?
        .into_iter()
        .filter_map(|(key, value, updated_at)| {
            settings_compat::sanitize(&SettingEntry {
                key,
                value,
                updated_at,
            })
        })
        .collect();
    tx.commit().await?;

    let snapshot = VaultSnapshot {
        exported_at: now(),
        groups,
        hosts,
        identities,
        keys,
        snippets,
        settings,
        port_forwards,
        sftp_bookmarks,
    };
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

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
    for f in &snapshot.port_forwards {
        merge_forward(&mut *tx, f).await?;
    }
    for b in &snapshot.sftp_bookmarks {
        merge_bookmark(&mut *tx, b).await?;
    }
    for entry in &snapshot.settings {
        merge_setting(&mut *tx, entry).await?;
    }
    repair_reference_cycles(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn export_encrypted(pool: &SqlitePool, passphrase: &str) -> AppResult<EncryptedEnvelope> {
    let snapshot = export_snapshot(pool).await?;
    encrypt_snapshot(&snapshot, passphrase).await
}

pub async fn encrypt_snapshot(
    snapshot: &VaultSnapshot,
    passphrase: &str,
) -> AppResult<EncryptedEnvelope> {
    validate_snapshot(snapshot)?;
    let bytes = serde_json::to_vec(&snapshot)?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(AppError::Invalid(format!(
            "vault snapshot exceeds the {} MiB backup limit",
            MAX_SNAPSHOT_BYTES / 1024 / 1024
        )));
    }
    let passphrase = passphrase.to_string();
    tokio::task::spawn_blocking(move || crypto::encrypt(&bytes, &passphrase))
        .await
        .map_err(|e| AppError::Other(format!("backup encryption task failed: {e}")))?
}

pub async fn decrypt_snapshot(
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<VaultSnapshot> {
    let envelope = envelope.clone();
    let passphrase = passphrase.to_string();
    let bytes = tokio::task::spawn_blocking(move || crypto::decrypt(&envelope, &passphrase))
        .await
        .map_err(|e| AppError::Other(format!("backup decryption task failed: {e}")))??;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(AppError::Invalid(format!(
            "vault snapshot exceeds the {} MiB backup limit",
            MAX_SNAPSHOT_BYTES / 1024 / 1024
        )));
    }
    let snapshot: VaultSnapshot = serde_json::from_slice(&bytes)?;
    validate_snapshot(&snapshot)?;
    Ok(snapshot)
}

pub async fn import_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<VaultSnapshot> {
    let snapshot = decrypt_snapshot(envelope, passphrase).await?;
    import_snapshot(pool, &snapshot).await?;
    Ok(snapshot)
}

pub async fn restore_snapshot(pool: &SqlitePool, snapshot: &VaultSnapshot) -> AppResult<()> {
    validate_snapshot(snapshot)?;
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
    repair_reference_cycles(&mut tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn restore_encrypted(
    pool: &SqlitePool,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<()> {
    let snapshot = decrypt_snapshot(envelope, passphrase).await?;
    restore_snapshot(pool, &snapshot).await
}

pub fn write_envelope_file(path: &Path, envelope: &EncryptedEnvelope) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(envelope)?;
    if bytes.len() as u64 > MAX_ENVELOPE_FILE_BYTES {
        return Err(AppError::Invalid(
            "encrypted backup file is too large".into(),
        ));
    }
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(AppError::Invalid(
            "backup destination folder does not exist".into(),
        ));
    }
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_dir())
    {
        return Err(AppError::Invalid(
            "backup destination must not be a directory".into(),
        ));
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::Invalid("backup destination must be a file".into()))?
        .to_string_lossy();
    let temp = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let write_result = (|| -> AppResult<()> {
        let mut file = options.open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);

        if path.exists() || path.symlink_metadata().is_ok() {
            let backup = parent.join(format!(".{file_name}.{}.bak", uuid::Uuid::new_v4()));
            std::fs::rename(path, &backup)?;
            if let Err(error) = std::fs::rename(&temp, path) {
                let _ = std::fs::rename(&backup, path);
                return Err(error.into());
            }
            std::fs::remove_file(&backup)?;
        } else {
            std::fs::rename(&temp, path)?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    write_result?;
    Ok(())
}

pub fn read_envelope_file(path: &Path) -> AppResult<EncryptedEnvelope> {
    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_ENVELOPE_FILE_BYTES {
        return Err(AppError::Invalid(
            "encrypted backup file is too large or invalid".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_ENVELOPE_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ENVELOPE_FILE_BYTES {
        return Err(AppError::Invalid(
            "encrypted backup file is too large".into(),
        ));
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn validate_snapshot(snapshot: &VaultSnapshot) -> AppResult<()> {
    validate_timestamp(&snapshot.exported_at, "snapshot export time")?;
    for (label, len) in [
        ("groups", snapshot.groups.len()),
        ("hosts", snapshot.hosts.len()),
        ("identities", snapshot.identities.len()),
        ("keys", snapshot.keys.len()),
        ("snippets", snapshot.snippets.len()),
        ("settings", snapshot.settings.len()),
        ("port forwards", snapshot.port_forwards.len()),
        ("SFTP bookmarks", snapshot.sftp_bookmarks.len()),
    ] {
        if len > MAX_RECORDS_PER_KIND {
            return Err(AppError::Invalid(format!("too many {label} in backup")));
        }
    }

    let mut ids = HashSet::new();
    macro_rules! records {
        ($values:expr, $label:literal) => {
            for value in $values {
                validate_record(
                    &mut ids,
                    $label,
                    &value.id,
                    &value.created_at,
                    &value.updated_at,
                    value.deleted_at.as_deref(),
                    value.revision,
                )?;
            }
            ids.clear();
        };
    }
    records!(&snapshot.groups, "group");
    records!(&snapshot.hosts, "host");
    records!(&snapshot.identities, "identity");
    records!(&snapshot.keys, "key");
    records!(&snapshot.snippets, "snippet");
    records!(&snapshot.port_forwards, "port forward");
    records!(&snapshot.sftp_bookmarks, "SFTP bookmark");
    Ok(())
}

fn validate_record(
    ids: &mut HashSet<String>,
    kind: &str,
    id: &str,
    created_at: &str,
    updated_at: &str,
    deleted_at: Option<&str>,
    revision: i64,
) -> AppResult<()> {
    if id.is_empty()
        || id.len() > MAX_SYNC_ID_BYTES
        || id.chars().any(char::is_control)
        || !ids.insert(id.to_string())
    {
        return Err(AppError::Invalid(format!("invalid or duplicate {kind} id")));
    }
    if revision < 1 {
        return Err(AppError::Invalid(format!("invalid {kind} revision")));
    }
    let created = parse_timestamp(created_at, &format!("{kind} creation time"))?;
    let updated = parse_timestamp(updated_at, &format!("{kind} update time"))?;
    if updated < created {
        return Err(AppError::Invalid(format!(
            "{kind} update time precedes its creation time"
        )));
    }
    if let Some(value) = deleted_at {
        validate_timestamp(value, &format!("{kind} deletion time"))?;
    }
    Ok(())
}

fn validate_timestamp(value: &str, label: &str) -> AppResult<()> {
    parse_timestamp(value, label).map(|_| ())
}

fn parse_timestamp(value: &str, label: &str) -> AppResult<chrono::DateTime<chrono::FixedOffset>> {
    let timestamp = chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| AppError::Invalid(format!("invalid {label} in backup")))?;
    if timestamp.with_timezone(&chrono::Utc)
        > chrono::Utc::now() + chrono::Duration::hours(MAX_CLOCK_SKEW_HOURS)
    {
        return Err(AppError::Invalid(format!(
            "{label} is too far in the future"
        )));
    }
    Ok(timestamp)
}

async fn repair_reference_cycles(tx: &mut sqlx::Transaction<'_, Sqlite>) -> AppResult<()> {
    repair_cycles(tx, "groups", "parent_id").await?;
    repair_cycles(tx, "hosts", "jump_host_id").await
}

async fn repair_cycles(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    table: &str,
    parent_column: &str,
) -> AppResult<()> {
    let sql = format!(
        "SELECT id, updated_at, {parent_column} FROM {table} \
         WHERE deleted_at IS NULL AND {parent_column} IS NOT NULL"
    );
    let pairs: Vec<(String, String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut **tx)
        .await?;
    let mut parents = HashMap::new();
    let mut timestamps = HashMap::new();
    for (id, updated_at, parent) in pairs {
        timestamps.insert(id.clone(), updated_at);
        parents.insert(id, parent);
    }
    let breakers = cycle_breakers(&parents);
    if breakers.is_empty() {
        return Ok(());
    }
    let sql = format!(
        "UPDATE {table} SET {parent_column} = NULL, updated_at = ?, revision = revision + 1 \
         WHERE id = ? AND deleted_at IS NULL"
    );
    for id in breakers {
        let updated_at = next_sync_timestamp(
            timestamps
                .get(&id)
                .expect("cycle breaker came from the queried records"),
        )?;
        sqlx::query(sqlx::AssertSqlSafe(sql.clone()))
            .bind(&updated_at)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

fn next_sync_timestamp(previous: &str) -> AppResult<String> {
    let previous = chrono::DateTime::parse_from_rfc3339(previous)
        .map_err(|_| AppError::Invalid("invalid sync conflict timestamp".into()))?
        .with_timezone(&chrono::Utc)
        + chrono::Duration::microseconds(1);
    let current = chrono::Utc::now();
    Ok(std::cmp::max(previous, current).to_rfc3339())
}

fn cycle_breakers(parents: &HashMap<String, String>) -> Vec<String> {
    let mut starts: Vec<&String> = parents.keys().collect();
    starts.sort_unstable();
    let mut complete: HashSet<String> = HashSet::new();
    let mut breakers: HashSet<String> = HashSet::new();
    for start in starts {
        if complete.contains(start) {
            continue;
        }
        let mut path: Vec<String> = Vec::new();
        let mut positions: HashMap<String, usize> = HashMap::new();
        let mut current = start.clone();
        loop {
            if complete.contains(&current) || !parents.contains_key(&current) {
                break;
            }
            if let Some(position) = positions.get(&current).copied() {
                if let Some(breaker) = path[position..].iter().max() {
                    breakers.insert((*breaker).clone());
                }
                break;
            }
            positions.insert(current.clone(), path.len());
            path.push(current.clone());
            current = parents[&current].clone();
        }
        complete.extend(path);
    }
    let mut breakers: Vec<String> = breakers.into_iter().collect();
    breakers.sort_unstable();
    breakers
}

async fn fetch_all<'e, T, E>(executor: E, table: &str) -> AppResult<Vec<T>>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
    E: Executor<'e, Database = Sqlite>,
{
    let sql = format!("SELECT * FROM {table}");
    Ok(sqlx::query_as::<_, T>(sqlx::AssertSqlSafe(sql))
        .fetch_all(executor)
        .await?)
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
    let password = secrets::seal_optional(
        &format!("identities:{}:password", i.id),
        i.password.as_deref(),
    )?;
    sqlx::query(
        "INSERT INTO identities (id, name, username, auth_type, key_id, password, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, username = excluded.username, auth_type = excluded.auth_type,
           key_id = excluded.key_id, password = excluded.password, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > identities.updated_at",
    )
    .bind(&i.id).bind(&i.name).bind(&i.username).bind(&i.auth_type).bind(&i.key_id).bind(password)
    .bind(&i.created_at).bind(&i.updated_at).bind(&i.deleted_at).bind(i.revision)
    .execute(executor).await?;
    Ok(())
}

async fn merge_key<'e, E>(executor: E, k: &SshKey) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    let private_key = secrets::seal_optional(
        &format!("keys:{}:private_key", k.id),
        k.private_key.as_deref(),
    )?;
    let passphrase = secrets::seal_optional(
        &format!("keys:{}:passphrase", k.id),
        k.passphrase.as_deref(),
    )?;
    sqlx::query(
        "INSERT INTO keys (id, name, public_key, private_key, passphrase, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, public_key = excluded.public_key, private_key = excluded.private_key,
           passphrase = excluded.passphrase, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > keys.updated_at",
    )
    .bind(&k.id).bind(&k.name).bind(&k.public_key).bind(private_key).bind(passphrase)
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
    let password =
        secrets::seal_optional(&format!("hosts:{}:password", h.id), h.password.as_deref())?;
    let requires_approval = h.requires_approval || h.color.as_deref() == Some("#ef4444");
    sqlx::query(
        "INSERT INTO hosts
           (id, label, address, port, group_id, identity_id, username, auth_type, key_id,
            os_hint, requires_approval, color, notes, jump_host_id, startup_command, password,
            last_used_at, created_at, updated_at, deleted_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label, address = excluded.address, port = excluded.port,
           group_id = excluded.group_id, identity_id = excluded.identity_id, username = excluded.username,
           auth_type = excluded.auth_type, key_id = excluded.key_id, os_hint = excluded.os_hint,
           requires_approval = excluded.requires_approval, color = NULL, notes = excluded.notes,
           jump_host_id = excluded.jump_host_id, startup_command = excluded.startup_command,
           password = excluded.password, last_used_at = excluded.last_used_at,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, revision = excluded.revision
         WHERE excluded.updated_at > hosts.updated_at",
    )
    .bind(&h.id).bind(&h.label).bind(&h.address).bind(h.port).bind(&h.group_id)
    .bind(&h.identity_id).bind(&h.username).bind(&h.auth_type).bind(&h.key_id)
    .bind(&h.os_hint).bind(requires_approval).bind(&h.notes)
    .bind(&h.jump_host_id).bind(&h.startup_command)
    .bind(password).bind(&h.last_used_at)
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
    let Some(entry) = settings_compat::sanitize(entry) else {
        return Ok(());
    };
    let value = secrets::seal_setting(&entry.key, &entry.value)?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE excluded.updated_at > settings.updated_at",
    )
    .bind(entry.key)
    .bind(value)
    .bind(entry.updated_at)
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
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for prefix in prefixes {
        query = query.bind(format!("{prefix}%"));
    }
    query.execute(executor).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    const BACKUP_TIMESTAMP: &str = "2026-07-15T00:00:00+00:00";

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn empty_snapshot(settings: Vec<SettingEntry>) -> VaultSnapshot {
        VaultSnapshot {
            exported_at: BACKUP_TIMESTAMP.to_string(),
            groups: Vec::new(),
            hosts: Vec::new(),
            identities: Vec::new(),
            keys: Vec::new(),
            snippets: Vec::new(),
            settings,
            port_forwards: Vec::new(),
            sftp_bookmarks: Vec::new(),
        }
    }

    fn setting(key: &str, value: &str) -> SettingEntry {
        SettingEntry {
            key: key.to_string(),
            value: value.to_string(),
            updated_at: BACKUP_TIMESTAMP.to_string(),
        }
    }

    #[tokio::test]
    async fn restore_drops_invalid_settings_and_keeps_internal_local_settings() {
        let pool = test_pool().await;
        settings_repo::set(&pool, "general.theme", "graphite:dark")
            .await
            .unwrap();
        settings_repo::set(&pool, "sync.connection", "local-connection")
            .await
            .unwrap();

        let snapshot = empty_snapshot(vec![
            setting("general.theme", "removed-theme"),
            setting("general.locale", "en"),
            setting("sync.connection", "backup-connection"),
        ]);
        restore_snapshot(&pool, &snapshot).await.unwrap();

        assert_eq!(
            settings_repo::get(&pool, "general.theme").await.unwrap(),
            None
        );
        assert_eq!(
            settings_repo::get(&pool, "general.locale")
                .await
                .unwrap()
                .as_deref(),
            Some("en")
        );
        assert_eq!(
            settings_repo::get(&pool, "sync.connection")
                .await
                .unwrap()
                .as_deref(),
            Some("local-connection")
        );
    }

    #[tokio::test]
    async fn import_drops_legacy_setting_keys() {
        let pool = test_pool().await;
        let snapshot = empty_snapshot(vec![
            setting("appearance.theme", "midnight:dark"),
            setting("general.theme", "graphite:dark"),
        ]);

        import_snapshot(&pool, &snapshot).await.unwrap();

        assert_eq!(
            settings_repo::get(&pool, "appearance.theme").await.unwrap(),
            None
        );
        assert_eq!(
            settings_repo::get(&pool, "general.theme")
                .await
                .unwrap()
                .as_deref(),
            Some("graphite:dark")
        );
    }

    #[tokio::test]
    async fn import_drops_each_incompatible_setting_individually() {
        let pool = test_pool().await;
        let mut invalid_timestamp = setting("general.fontFamily", "Mono");
        invalid_timestamp.updated_at = "invalid".into();
        let snapshot = empty_snapshot(vec![
            setting("general.locale", "zh-CN"),
            setting("general.theme", "removed-theme"),
            setting("future.setting", "value"),
            invalid_timestamp,
        ]);

        import_snapshot(&pool, &snapshot).await.unwrap();

        assert_eq!(
            settings_repo::get(&pool, "general.locale")
                .await
                .unwrap()
                .as_deref(),
            Some("zh-CN")
        );
        assert_eq!(
            settings_repo::get(&pool, "general.theme").await.unwrap(),
            None
        );
        assert_eq!(
            settings_repo::get(&pool, "future.setting").await.unwrap(),
            None
        );
        assert_eq!(
            settings_repo::get(&pool, "general.fontFamily")
                .await
                .unwrap(),
            None
        );
    }

    #[test]
    fn fingerprint_includes_content_not_only_revision() {
        let mut first = empty_snapshot(Vec::new());
        first.groups.push(Group {
            id: "group-1".into(),
            name: "Production".into(),
            parent_id: None,
            sort_order: 0,
            created_at: BACKUP_TIMESTAMP.into(),
            updated_at: BACKUP_TIMESTAMP.into(),
            deleted_at: None,
            revision: 2,
        });
        let mut second = first.clone();
        second.groups[0].name = "Staging".into();

        assert_ne!(
            first.content_fingerprint(),
            second.content_fingerprint(),
            "two devices can produce the same revision with different content"
        );
        second.groups[0].name = first.groups[0].name.clone();
        second.exported_at = "2100-02-02T00:00:00+00:00".into();
        assert_eq!(first.content_fingerprint(), second.content_fingerprint());
    }

    #[tokio::test]
    async fn rejects_invalid_records_before_starting_a_merge() {
        let pool = test_pool().await;
        let mut snapshot = empty_snapshot(Vec::new());
        snapshot.groups.push(Group {
            id: "group-1".into(),
            name: "Invalid".into(),
            parent_id: None,
            sort_order: 0,
            created_at: BACKUP_TIMESTAMP.into(),
            updated_at: "not-a-time".into(),
            deleted_at: None,
            revision: 0,
        });

        assert!(matches!(
            import_snapshot(&pool, &snapshot).await,
            Err(AppError::Invalid(_))
        ));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM groups")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn conflict_merge_breaks_reference_cycles_deterministically() {
        let pool = test_pool().await;
        let mut snapshot = empty_snapshot(Vec::new());
        snapshot.groups = vec![
            Group {
                id: "group-a".into(),
                name: "A".into(),
                parent_id: Some("group-b".into()),
                sort_order: 0,
                created_at: BACKUP_TIMESTAMP.into(),
                updated_at: BACKUP_TIMESTAMP.into(),
                deleted_at: None,
                revision: 2,
            },
            Group {
                id: "group-b".into(),
                name: "B".into(),
                parent_id: Some("group-a".into()),
                sort_order: 0,
                created_at: BACKUP_TIMESTAMP.into(),
                updated_at: BACKUP_TIMESTAMP.into(),
                deleted_at: None,
                revision: 2,
            },
        ];

        import_snapshot(&pool, &snapshot).await.unwrap();
        let rows: Vec<(String, Option<String>, i64)> =
            sqlx::query_as("SELECT id, parent_id, revision FROM groups ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows[0], ("group-a".into(), Some("group-b".into()), 2));
        assert_eq!(rows[1], ("group-b".into(), None, 3));

        let parents = HashMap::from([
            ("a".into(), "b".into()),
            ("b".into(), "c".into()),
            ("c".into(), "a".into()),
            ("x".into(), "y".into()),
        ]);
        assert_eq!(cycle_breakers(&parents), vec!["c"]);
    }

    #[test]
    fn encrypted_file_write_replaces_atomically_and_uses_private_permissions() {
        let dir = std::env::temp_dir().join(format!("sageport-sync-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("vault.json");
        fs::write(&path, b"old partial data").unwrap();
        let envelope = crypto::encrypt(b"vault data", "passphrase").unwrap();

        write_envelope_file(&path, &envelope).unwrap();
        let loaded = read_envelope_file(&path).unwrap();
        assert_eq!(
            crypto::decrypt(&loaded, "passphrase").unwrap(),
            b"vault data"
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
