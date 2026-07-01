use sqlx::SqlitePool;

use crate::domain::now;
use crate::error::AppResult;

pub async fn get(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(v,)| v))
}

pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(&ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn all(pool: &SqlitePool) -> AppResult<Vec<(String, String)>> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// Every setting row with its `updated_at`, excluding keys under `prefix`
/// (dot-separated, e.g. `"sync."`). Used by the vault backup/restore path to
/// carry every app setting *except* the sync connection itself (token, gist
/// id, passphrase, last-synced marker) — those are per-device and must never
/// round-trip through a backup.
pub async fn all_excluding_prefix(
    pool: &SqlitePool,
    prefix: &str,
) -> AppResult<Vec<(String, String, String)>> {
    let like_pattern = format!("{prefix}%");
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT key, value, updated_at FROM settings WHERE key NOT LIKE ? ORDER BY key",
    )
    .bind(like_pattern)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Upsert a setting only if `updated_at` is newer than what's stored
/// (last-write-wins), mirroring the merge semantics of the entity tables.
pub async fn merge(pool: &SqlitePool, key: &str, value: &str, updated_at: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE excluded.updated_at > settings.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete every setting except those under `prefix` (dot-separated). Used
/// before a destructive vault restore so a rollback can't be used to wipe out
/// the local sync connection it was fetched through.
pub async fn delete_all_excluding_prefix(pool: &SqlitePool, prefix: &str) -> AppResult<()> {
    let like_pattern = format!("{prefix}%");
    sqlx::query("DELETE FROM settings WHERE key NOT LIKE ?")
        .bind(like_pattern)
        .execute(pool)
        .await?;
    Ok(())
}
