use sqlx::SqlitePool;

use crate::domain::{new_id, now};
use crate::error::AppResult;

pub async fn add(pool: &SqlitePool, host_id: &str, command: &str) -> AppResult<()> {
    let command = command.trim();
    if command.is_empty() || command.len() > 500 {
        return Ok(());
    }
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO command_history (id, host_id, command, used_at, use_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(host_id, command) DO UPDATE SET
           used_at = excluded.used_at, use_count = use_count + 1",
    )
    .bind(&id)
    .bind(host_id)
    .bind(command)
    .bind(&ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn search(
    pool: &SqlitePool,
    host_id: &str,
    prefix: &str,
    limit: i64,
) -> AppResult<Vec<String>> {
    let pattern = format!("{}%", prefix.replace('%', "\\%").replace('_', "\\_"));
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT command FROM command_history
         WHERE host_id = ? AND command LIKE ? ESCAPE '\\' AND command <> ?
         ORDER BY use_count DESC, used_at DESC
         LIMIT ?",
    )
    .bind(host_id)
    .bind(&pattern)
    .bind(prefix)
    .bind(limit.clamp(1, 50))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM command_history")
        .execute(pool)
        .await?;
    Ok(())
}
