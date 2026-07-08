use sqlx::SqlitePool;

use crate::domain::{new_id, now, SftpBookmark, SftpBookmarkInput};
use crate::error::{AppError, AppResult};

fn normalize(mut input: SftpBookmarkInput) -> AppResult<SftpBookmarkInput> {
    input.label = input.label.trim().to_string();
    input.path = input.path.trim().to_string();
    input.host_id = input.host_id.filter(|v| !v.is_empty());
    if input.label.is_empty() {
        return Err(AppError::Invalid("bookmark label is required".into()));
    }
    if input.path.is_empty() {
        return Err(AppError::Invalid("bookmark path is required".into()));
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<SftpBookmark>> {
    let rows = sqlx::query_as::<_, SftpBookmark>(
        "SELECT * FROM sftp_bookmarks WHERE deleted_at IS NULL
         ORDER BY sort_order, label COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create(pool: &SqlitePool, input: SftpBookmarkInput) -> AppResult<SftpBookmark> {
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO sftp_bookmarks
           (id, host_id, label, path, sort_order, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, 0, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.host_id)
    .bind(&input.label)
    .bind(&input.path)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<SftpBookmark> {
    sqlx::query_as::<_, SftpBookmark>(
        "SELECT * FROM sftp_bookmarks WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("bookmark {id}")))
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE sftp_bookmarks
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("bookmark {id}")));
    }
    Ok(())
}
