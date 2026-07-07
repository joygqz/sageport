use sqlx::SqlitePool;

use crate::domain::now;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TransferRow {
    pub id: String,
    pub source_label: String,
    pub source_path: String,
    pub source_connection_id: Option<String>,
    pub dest_path: String,
    pub dest_connection_id: Option<String>,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub status: String,
    pub message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool: &SqlitePool,
    id: &str,
    source_label: &str,
    source_path: &str,
    source_connection_id: Option<&str>,
    dest_path: &str,
    dest_connection_id: Option<&str>,
) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO sftp_transfers
            (id, source_label, source_path, source_connection_id, dest_path,
             dest_connection_id, total_bytes, transferred_bytes, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'active', ?)",
    )
    .bind(id)
    .bind(source_label)
    .bind(source_path)
    .bind(source_connection_id)
    .bind(dest_path)
    .bind(dest_connection_id)
    .bind(&ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn finish(
    pool: &SqlitePool,
    id: &str,
    transferred_bytes: u64,
    total_bytes: u64,
    status: &str,
    message: Option<&str>,
) -> AppResult<()> {
    let ts = now();
    let transferred_bytes = i64::try_from(transferred_bytes)
        .map_err(|_| AppError::Invalid("transferred byte count is too large".into()))?;
    let total_bytes = i64::try_from(total_bytes)
        .map_err(|_| AppError::Invalid("total byte count is too large".into()))?;
    sqlx::query(
        "UPDATE sftp_transfers
         SET transferred_bytes = ?, total_bytes = ?, status = ?, message = ?, finished_at = ?
         WHERE id = ?",
    )
    .bind(transferred_bytes)
    .bind(total_bytes)
    .bind(status)
    .bind(message)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list(pool: &SqlitePool, limit: i64) -> AppResult<Vec<TransferRow>> {
    let rows = sqlx::query_as::<_, TransferRow>(
        "SELECT id, source_label, source_path, source_connection_id, dest_path,
                dest_connection_id, total_bytes, transferred_bytes, status, message,
                started_at, finished_at
         FROM sftp_transfers
         ORDER BY started_at DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let affected = sqlx::query("DELETE FROM sftp_transfers WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("transfer {id}")));
    }
    Ok(())
}

pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM sftp_transfers")
        .execute(pool)
        .await?;
    Ok(())
}
