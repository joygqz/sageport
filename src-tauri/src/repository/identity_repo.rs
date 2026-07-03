use sqlx::SqlitePool;

use crate::domain::{auth, new_id, now, Identity, IdentityInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

/// Only one of `key_id` / `password` is meaningful for a given `auth_type`;
/// clear whichever one doesn't apply so switching auth methods can't leave a
/// stale secret or key reference behind.
fn normalize(mut input: IdentityInput) -> IdentityInput {
    if input.auth_type == auth::KEY {
        input.password = Some(String::new());
    } else {
        input.key_id = None;
        if input.auth_type != auth::PASSWORD {
            input.password = Some(String::new());
        }
    }
    input
}

async fn hosts_using(pool: &SqlitePool, id: &str) -> AppResult<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hosts WHERE identity_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

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
    let input = normalize(input);
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
    let input = normalize(input);
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
    let in_use = hosts_using(pool, id).await?;
    if in_use > 0 {
        return Err(AppError::InUse(format!(
            "identity is used by {in_use} host(s); reassign them before deleting"
        )));
    }

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
