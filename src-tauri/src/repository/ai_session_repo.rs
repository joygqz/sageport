use sqlx::SqlitePool;

use crate::domain::{new_id, now};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct AiSessionRow {
    pub id: String,
    pub title: String,
    pub messages: String,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<AiSessionRow>> {
    let rows = sqlx::query_as::<_, AiSessionRow>(
        "SELECT id, title, messages, created_at, updated_at FROM ai_sessions
         ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<AiSessionRow> {
    sqlx::query_as::<_, AiSessionRow>(
        "SELECT id, title, messages, created_at, updated_at FROM ai_sessions WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("ai session {id}")))
}

pub async fn create(pool: &SqlitePool) -> AppResult<AiSessionRow> {
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO ai_sessions (id, title, messages, created_at, updated_at)
         VALUES (?, '', '[]', ?, ?)",
    )
    .bind(&id)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn save(
    pool: &SqlitePool,
    id: &str,
    messages_json: &str,
    title: Option<&str>,
) -> AppResult<AiSessionRow> {
    let ts = now();
    let affected = if let Some(title) = title {
        sqlx::query("UPDATE ai_sessions SET messages = ?, title = ?, updated_at = ? WHERE id = ?")
            .bind(messages_json)
            .bind(title)
            .bind(&ts)
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected()
    } else {
        sqlx::query("UPDATE ai_sessions SET messages = ?, updated_at = ? WHERE id = ?")
            .bind(messages_json)
            .bind(&ts)
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected()
    };
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    get(pool, id).await
}

pub async fn rename(pool: &SqlitePool, id: &str, title: &str) -> AppResult<AiSessionRow> {
    let affected = sqlx::query("UPDATE ai_sessions SET title = ? WHERE id = ?")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let affected = sqlx::query("DELETE FROM ai_sessions WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("ai session {id}")));
    }
    Ok(())
}
