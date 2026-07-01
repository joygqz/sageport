use sqlx::SqlitePool;

use crate::domain::{new_id, now, Identity, IdentityInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Identity>> {
    let rows = sqlx::query_as::<_, Identity>(
        "SELECT * FROM identities WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Identity> {
    sqlx::query_as::<_, Identity>("SELECT * FROM identities WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("identity {id}")))
}

pub async fn create(pool: &SqlitePool, input: IdentityInput) -> AppResult<Identity> {
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO identities
           (id, name, username, auth_type, key_id, password, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(none_if_empty(input.password.as_deref()))
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;

    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: IdentityInput) -> AppResult<Identity> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE identities SET
           name = ?, username = ?, auth_type = ?, key_id = ?,
           updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("identity {id}")));
    }

    // Only touch the stored password when explicitly sent; empty clears it.
    if input.password.is_some() {
        sqlx::query("UPDATE identities SET password = ? WHERE id = ?")
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
        "UPDATE identities SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
