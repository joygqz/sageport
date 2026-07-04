use sqlx::SqlitePool;

use crate::domain::{new_id, now, Snippet, SnippetInput};
use crate::error::{AppError, AppResult};

fn normalize(mut input: SnippetInput) -> AppResult<SnippetInput> {
    input.name = input.name.trim().to_string();
    input.command = input.command.trim().to_string();
    input.description = input
        .description
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if input.name.is_empty() {
        return Err(AppError::Invalid("snippet name is required".into()));
    }
    if input.command.is_empty() {
        return Err(AppError::Invalid("snippet command is required".into()));
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Snippet>> {
    let rows = sqlx::query_as::<_, Snippet>(
        "SELECT * FROM snippets WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Snippet> {
    sqlx::query_as::<_, Snippet>("SELECT * FROM snippets WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("snippet {id}")))
}

pub async fn create(pool: &SqlitePool, input: SnippetInput) -> AppResult<Snippet> {
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO snippets (id, name, command, description, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.command)
    .bind(&input.description)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: SnippetInput) -> AppResult<Snippet> {
    let input = normalize(input)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE snippets SET name = ?, command = ?, description = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.command)
    .bind(&input.description)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("snippet {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE snippets
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
        return Err(AppError::NotFound(format!("snippet {id}")));
    }
    Ok(())
}
