use sqlx::SqlitePool;

use crate::domain::{new_id, now, Group, GroupInput};
use crate::error::{AppError, AppResult};

fn normalize(mut input: GroupInput) -> AppResult<GroupInput> {
    input.name = input.name.trim().to_string();
    input.parent_id = input
        .parent_id
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if input.name.is_empty() {
        return Err(AppError::Invalid("group name is required".into()));
    }
    Ok(input)
}

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
    let input = normalize(input)?;
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
    let input = normalize(input)?;
    if input.parent_id.as_deref() == Some(id) {
        return Err(AppError::Invalid("a group cannot be its own parent".into()));
    }
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

pub async fn delete(pool: &SqlitePool, id: &str, delete_hosts: bool) -> AppResult<()> {
    get(pool, id).await?;
    let ts = now();
    if delete_hosts {
        sqlx::query(
            "UPDATE hosts SET deleted_at = ?, updated_at = ?, revision = revision + 1
             WHERE group_id = ? AND deleted_at IS NULL",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            "UPDATE hosts SET group_id = NULL, updated_at = ?, revision = revision + 1
             WHERE group_id = ? AND deleted_at IS NULL",
        )
        .bind(&ts)
        .bind(id)
        .execute(pool)
        .await?;
    }
    let affected = sqlx::query(
        "UPDATE groups
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
        return Err(AppError::NotFound(format!("group {id}")));
    }
    Ok(())
}
