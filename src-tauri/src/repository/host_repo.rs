use sqlx::SqlitePool;

use crate::domain::{auth, new_id, now, Host, HostInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

const MIN_PORT: i64 = 1;
const MAX_PORT: i64 = u16::MAX as i64;

fn clean_optional(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
}

fn normalize(mut input: HostInput) -> AppResult<HostInput> {
    input.label = input.label.trim().to_string();
    input.address = input.address.trim().to_string();
    clean_optional(&mut input.group_id);
    clean_optional(&mut input.identity_id);
    clean_optional(&mut input.username);
    clean_optional(&mut input.auth_type);
    clean_optional(&mut input.key_id);
    clean_optional(&mut input.os_hint);
    clean_optional(&mut input.color);
    clean_optional(&mut input.notes);
    clean_optional(&mut input.jump_host_id);
    clean_optional(&mut input.startup_command);

    if input.label.is_empty() {
        return Err(AppError::Invalid("host label is required".into()));
    }
    if input.address.is_empty() {
        return Err(AppError::Invalid("host address is required".into()));
    }
    if !(MIN_PORT..=MAX_PORT).contains(&input.port) {
        return Err(AppError::Invalid(format!(
            "port must be between {MIN_PORT} and {MAX_PORT}"
        )));
    }
    if let Some(auth_type) = input.auth_type.as_deref() {
        if !matches!(auth_type, auth::PASSWORD | auth::KEY | auth::AGENT) {
            return Err(AppError::Invalid(format!("unknown auth type: {auth_type}")));
        }
    }

    if input.identity_id.is_some() {
        input.username = None;
        input.auth_type = None;
        input.key_id = None;
        input.password = Some(String::new());
    } else {
        if input.auth_type.as_deref() != Some(auth::KEY) {
            input.key_id = None;
        }
        if input.auth_type.as_deref() != Some(auth::PASSWORD) {
            input.password = Some(String::new());
        }
    }
    Ok(input)
}

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
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO hosts
           (id, label, address, port, group_id, identity_id, username, auth_type, key_id,
            os_hint, color, notes, jump_host_id, startup_command, password, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
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
    .bind(&input.jump_host_id)
    .bind(&input.startup_command)
    .bind(none_if_empty(input.password.as_deref()))
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;

    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: HostInput) -> AppResult<Host> {
    let input = normalize(input)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE hosts SET
           label = ?, address = ?, port = ?, group_id = ?, identity_id = ?, username = ?,
           auth_type = ?, key_id = ?, os_hint = ?, color = ?, notes = ?,
           jump_host_id = ?, startup_command = ?,
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
    .bind(&input.jump_host_id)
    .bind(&input.startup_command)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("host {id}")));
    }

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
    let affected = sqlx::query(
        "UPDATE hosts
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
        return Err(AppError::NotFound(format!("host {id}")));
    }
    Ok(())
}

pub async fn touch_last_used(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query("UPDATE hosts SET last_used_at = ? WHERE id = ?")
        .bind(&ts)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
