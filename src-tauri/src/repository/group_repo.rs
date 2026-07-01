use sqlx::SqlitePool;

use crate::domain::{new_id, now, Group, GroupInput};
use crate::error::{AppError, AppResult};

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Group>> {
    let rows = sqlx::query_as::<_, Group>(
        "SELECT * FROM groups WHERE deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Group> {
    sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))
}

pub async fn create(pool: &SqlitePool, input: GroupInput) -> AppResult<Group> {
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO groups (id, name, parent_id, sort_order, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(input.sort_order)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: GroupInput) -> AppResult<Group> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE groups
         SET name = ?, parent_id = ?, sort_order = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(input.sort_order)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("group {id}")));
    }
    get(pool, id).await
}

/// Soft-delete (tombstone) so the change can propagate through sync.
pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "UPDATE groups SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
