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
    let affected = sqlx::query("DELETE FROM sftp_transfers WHERE id = ? AND status != 'active'")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sftp_transfers WHERE id = ? AND status = 'active')",
        )
        .bind(id)
        .fetch_one(pool)
        .await?;
        if active {
            return Err(AppError::InUse(format!("transfer {id} is still active")));
        }
        return Err(AppError::NotFound(format!("transfer {id}")));
    }
    Ok(())
}

pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM sftp_transfers WHERE status != 'active'")
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_interrupted(pool: &SqlitePool) -> AppResult<u64> {
    let ts = now();
    let result = sqlx::query(
        "UPDATE sftp_transfers
         SET status = 'error', message = 'application closed before transfer completed',
             finished_at = ?
         WHERE status = 'active'",
    )
    .bind(ts)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::{clear, create, delete, finish, list, mark_interrupted};
    use crate::error::AppError;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        sqlx::query(
            "CREATE TABLE sftp_transfers (
                id TEXT PRIMARY KEY NOT NULL,
                source_label TEXT NOT NULL,
                source_path TEXT NOT NULL,
                source_connection_id TEXT,
                dest_path TEXT NOT NULL,
                dest_connection_id TEXT,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                transferred_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                message TEXT,
                started_at TEXT NOT NULL,
                finished_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .expect("create transfer table");
        pool
    }

    #[tokio::test]
    async fn protects_active_history_and_recovers_interrupted_transfers() {
        let pool = pool().await;
        create(&pool, "active", "a", "/a", None, "/dest", None)
            .await
            .expect("create active transfer");
        create(&pool, "done", "b", "/b", None, "/dest", None)
            .await
            .expect("create finished transfer");
        finish(&pool, "done", 2, 2, "done", None)
            .await
            .expect("finish transfer");

        assert!(matches!(
            delete(&pool, "active").await,
            Err(AppError::InUse(_))
        ));
        clear(&pool).await.expect("clear finished history");
        assert_eq!(list(&pool, 10).await.expect("list history").len(), 1);

        assert_eq!(mark_interrupted(&pool).await.expect("recover active"), 1);
        let rows = list(&pool, 10).await.expect("list recovered history");
        assert_eq!(rows[0].status, "error");
        assert!(rows[0].finished_at.is_some());
        clear(&pool).await.expect("clear recovered history");
        assert!(list(&pool, 10)
            .await
            .expect("list empty history")
            .is_empty());
    }
}
