use sqlx::SqlitePool;

use crate::domain::{new_id, now, CommandHistoryEntry};
use crate::error::{AppError, AppResult};

const MAX_HOST_ID_BYTES: usize = 128;
const MAX_COMMAND_CHARS: usize = 500;
const MAX_QUERY_CHARS: usize = 500;
const MAX_ENTRIES_PER_HOST: i64 = 1_000;
const MAX_USE_COUNT: i64 = (1i64 << 53) - 1;

fn validate_host_id(host_id: &str) -> AppResult<()> {
    if host_id.len() > MAX_HOST_ID_BYTES || host_id.contains('\0') {
        return Err(AppError::Invalid("invalid command history host id".into()));
    }
    Ok(())
}

fn normalize_command(command: &str) -> AppResult<Option<&str>> {
    let command = command.trim();
    if command.is_empty() {
        return Ok(None);
    }
    if command.chars().count() > MAX_COMMAND_CHARS
        || command.contains('\0')
        || command.contains(['\r', '\n'])
    {
        return Err(AppError::Invalid("invalid command history entry".into()));
    }
    Ok(Some(command))
}

pub async fn add(pool: &SqlitePool, host_id: &str, command: &str) -> AppResult<()> {
    validate_host_id(host_id)?;
    let Some(command) = normalize_command(command)? else {
        return Ok(());
    };
    let id = new_id();
    let ts = now();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO command_history (id, host_id, command, used_at, use_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(host_id, command) DO UPDATE SET
           used_at = excluded.used_at,
           use_count = CASE WHEN use_count < ? THEN use_count + 1 ELSE use_count END",
    )
    .bind(&id)
    .bind(host_id)
    .bind(command)
    .bind(&ts)
    .bind(MAX_USE_COUNT)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM command_history
         WHERE host_id = ? AND id NOT IN (
           SELECT id FROM command_history WHERE host_id = ?
           ORDER BY used_at DESC, id DESC LIMIT ?
         )",
    )
    .bind(host_id)
    .bind(host_id)
    .bind(MAX_ENTRIES_PER_HOST)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn search(
    pool: &SqlitePool,
    host_id: &str,
    prefix: &str,
    limit: i64,
) -> AppResult<Vec<String>> {
    validate_host_id(host_id)?;
    if prefix.is_empty() || prefix.chars().count() > MAX_QUERY_CHARS || prefix.contains('\0') {
        return Ok(Vec::new());
    }
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT command FROM command_history
         WHERE host_id = ?
           AND substr(command, 1, length(?)) = ? COLLATE BINARY
           AND command <> ?
         ORDER BY use_count DESC, used_at DESC
         LIMIT ?",
    )
    .bind(host_id)
    .bind(prefix)
    .bind(prefix)
    .bind(prefix)
    .bind(limit.clamp(1, 50))
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(c,)| c).collect())
}

pub async fn list(
    pool: &SqlitePool,
    host_id: Option<&str>,
    query: Option<&str>,
    limit: i64,
) -> AppResult<Vec<CommandHistoryEntry>> {
    if let Some(host_id) = host_id {
        validate_host_id(host_id)?;
    }
    let query = query.map(str::trim).filter(|value| !value.is_empty());
    if query.is_some_and(|value| value.chars().count() > MAX_QUERY_CHARS || value.contains('\0')) {
        return Err(AppError::Invalid("invalid command history query".into()));
    }
    let rows = sqlx::query_as::<_, CommandHistoryEntry>(
        "SELECT h.id, h.host_id, hosts.label AS host_label, h.command, h.used_at, h.use_count
         FROM command_history AS h
         LEFT JOIN hosts ON hosts.id = h.host_id
         WHERE (?1 IS NULL OR h.host_id = ?1)
           AND (?2 IS NULL OR instr(lower(h.command), lower(?2)) > 0)
         ORDER BY h.used_at DESC, h.id DESC
         LIMIT ?3",
    )
    .bind(host_id)
    .bind(query)
    .bind(limit.clamp(1, 500))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM command_history")
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn adds_searches_filters_and_clears_history() {
        let pool = test_pool().await;
        add(&pool, "host-1", " git status ").await.unwrap();
        add(&pool, "host-1", "git status").await.unwrap();
        add(&pool, "host-1", "git log").await.unwrap();
        add(&pool, "", "git diff").await.unwrap();

        assert_eq!(
            search(&pool, "host-1", "git s", 5).await.unwrap(),
            ["git status"]
        );
        assert!(search(&pool, "host-1", "Git", 5).await.unwrap().is_empty());

        let host_entries = list(&pool, Some("host-1"), Some("LOG"), 100).await.unwrap();
        assert_eq!(host_entries.len(), 1);
        assert_eq!(host_entries[0].command, "git log");
        let all_entries = list(&pool, None, None, 100).await.unwrap();
        assert_eq!(all_entries.len(), 3);
        assert_eq!(
            all_entries
                .iter()
                .find(|e| e.command == "git status")
                .unwrap()
                .use_count,
            2
        );

        clear(&pool).await.unwrap();
        assert!(list(&pool, None, None, 100).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_unsafe_or_oversized_entries() {
        let pool = test_pool().await;
        assert!(add(&pool, "host", "echo one\necho two").await.is_err());
        assert!(add(&pool, &"x".repeat(MAX_HOST_ID_BYTES + 1), "echo ok")
            .await
            .is_err());
        assert!(add(&pool, "host", &"x".repeat(MAX_COMMAND_CHARS + 1))
            .await
            .is_err());
        assert!(add(&pool, "host", &"命".repeat(MAX_COMMAND_CHARS))
            .await
            .is_ok());
    }
}
