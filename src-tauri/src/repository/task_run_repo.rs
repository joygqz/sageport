use sqlx::SqlitePool;

use crate::domain::now;
use crate::error::{AppError, AppResult};

/// Upper bound on retained runs. History is device-local and grows one row per
/// run, so the oldest rows are pruned on insert to keep the table bounded.
const MAX_HISTORY_ENTRIES: i64 = 500;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TaskRunRow {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub host_id: Option<String>,
    pub host_label: Option<String>,
    pub steps: String,
    pub total_steps: i64,
    pub status: String,
    pub message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool: &SqlitePool,
    id: &str,
    task_id: &str,
    task_name: &str,
    host_id: Option<&str>,
    host_label: Option<&str>,
    steps_json: &str,
    total_steps: i64,
) -> AppResult<()> {
    let ts = now();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO task_runs
            (id, task_id, task_name, host_id, host_label, steps, total_steps, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)",
    )
    .bind(id)
    .bind(task_id)
    .bind(task_name)
    .bind(host_id)
    .bind(host_label)
    .bind(steps_json)
    .bind(total_steps)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "DELETE FROM task_runs
         WHERE id NOT IN (
           SELECT id FROM task_runs ORDER BY started_at DESC, id DESC LIMIT ?
         )",
    )
    .bind(MAX_HISTORY_ENTRIES)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn finish(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    message: Option<&str>,
    steps_json: &str,
) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "UPDATE task_runs
         SET status = ?, message = ?, steps = ?, finished_at = ?
         WHERE id = ?",
    )
    .bind(status)
    .bind(message)
    .bind(steps_json)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list(pool: &SqlitePool, limit: i64) -> AppResult<Vec<TaskRunRow>> {
    let rows = sqlx::query_as::<_, TaskRunRow>(
        "SELECT id, task_id, task_name, host_id, host_label, steps, total_steps,
                status, message, started_at, finished_at
         FROM task_runs
         ORDER BY started_at DESC, id DESC
         LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let affected = sqlx::query("DELETE FROM task_runs WHERE id = ? AND status != 'running'")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();
    if affected == 0 {
        let running: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM task_runs WHERE id = ? AND status = 'running')",
        )
        .bind(id)
        .fetch_one(pool)
        .await?;
        if running {
            return Err(AppError::InUse(format!("task run {id} is still running")));
        }
        return Err(AppError::NotFound(format!("task run {id}")));
    }
    Ok(())
}

pub async fn clear(pool: &SqlitePool) -> AppResult<()> {
    sqlx::query("DELETE FROM task_runs WHERE status != 'running'")
        .execute(pool)
        .await?;
    Ok(())
}

/// Flip runs still marked `running` to `error` on startup — a leftover `running`
/// row means the app closed mid-run, so the run never actually finished.
pub async fn mark_interrupted(pool: &SqlitePool) -> AppResult<u64> {
    let ts = now();
    let result = sqlx::query(
        "UPDATE task_runs
         SET status = 'error', message = 'application closed before the run finished',
             finished_at = ?
         WHERE status = 'running'",
    )
    .bind(ts)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
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
    async fn records_finishes_and_prunes_history() {
        let pool = test_pool().await;
        create(&pool, "run-1", "task-1", "Deploy", Some("host-1"), Some("web-01"), "[]", 2)
            .await
            .unwrap();
        finish(&pool, "run-1", "done", None, "[{\"status\":\"done\"}]")
            .await
            .unwrap();

        let rows = list(&pool, 10).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "done");
        assert_eq!(rows[0].host_label.as_deref(), Some("web-01"));
        assert!(rows[0].finished_at.is_some());
        assert_eq!(rows[0].steps, "[{\"status\":\"done\"}]");
    }

    #[tokio::test]
    async fn protects_running_rows_and_recovers_on_startup() {
        let pool = test_pool().await;
        create(&pool, "running", "task-1", "Deploy", None, None, "[]", 1)
            .await
            .unwrap();
        create(&pool, "done", "task-1", "Deploy", None, None, "[]", 1)
            .await
            .unwrap();
        finish(&pool, "done", "done", None, "[]").await.unwrap();

        assert!(matches!(
            delete(&pool, "running").await,
            Err(AppError::InUse(_))
        ));
        assert!(matches!(
            delete(&pool, "missing").await,
            Err(AppError::NotFound(_))
        ));

        delete(&pool, "done").await.unwrap();
        assert_eq!(list(&pool, 10).await.unwrap().len(), 1);

        assert_eq!(mark_interrupted(&pool).await.unwrap(), 1);
        let rows = list(&pool, 10).await.unwrap();
        assert_eq!(rows[0].status, "error");
        assert!(rows[0].message.is_some());

        clear(&pool).await.unwrap();
        assert!(list(&pool, 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn caps_stored_runs_at_the_history_limit() {
        let pool = test_pool().await;
        for i in 0..(MAX_HISTORY_ENTRIES + 5) {
            let id = format!("run-{i:04}");
            create(&pool, &id, "task-1", "Deploy", None, None, "[]", 0)
                .await
                .unwrap();
        }
        assert_eq!(
            list(&pool, MAX_HISTORY_ENTRIES + 100).await.unwrap().len() as i64,
            MAX_HISTORY_ENTRIES
        );
    }
}
