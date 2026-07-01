use sqlx::SqlitePool;

use crate::domain::{new_id, now, Host, HostInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Host>> {
    let rows = sqlx::query_as::<_, Host>(
        "SELECT * FROM hosts WHERE deleted_at IS NULL ORDER BY label COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Host> {
    sqlx::query_as::<_, Host>("SELECT * FROM hosts WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("host {id}")))
}

pub async fn create(pool: &SqlitePool, input: HostInput) -> AppResult<Host> {
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO hosts
           (id, label, address, port, group_id, identity_id, username, auth_type, key_id,
            os_hint, color, notes, password, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.label)
    .bind(&input.address)
    .bind(input.port)
    .bind(&input.group_id)
    .bind(&input.identity_id)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(&input.os_hint)
    .bind(&input.color)
    .bind(&input.notes)
    .bind(none_if_empty(input.password.as_deref()))
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;

    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: HostInput) -> AppResult<Host> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE hosts SET
           label = ?, address = ?, port = ?, group_id = ?, identity_id = ?, username = ?,
           auth_type = ?, key_id = ?, os_hint = ?, color = ?, notes = ?,
           updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.label)
    .bind(&input.address)
    .bind(input.port)
    .bind(&input.group_id)
    .bind(&input.identity_id)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(&input.os_hint)
    .bind(&input.color)
    .bind(&input.notes)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("host {id}")));
    }

    // Only touch the stored password when the caller explicitly sent one; an
    // empty string clears it.
    if input.password.is_some() {
        sqlx::query("UPDATE hosts SET password = ? WHERE id = ?")
            .bind(none_if_empty(input.password.as_deref()))
            .bind(id)
            .execute(pool)
            .await?;
    }

    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "UPDATE hosts SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a successful connection for recents / sorting.
pub async fn touch_last_used(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query("UPDATE hosts SET last_used_at = ? WHERE id = ?")
        .bind(&ts)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
