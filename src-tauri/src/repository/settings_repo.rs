use sqlx::{Executor, Sqlite, SqlitePool};

use crate::domain::now;
use crate::error::AppResult;

pub async fn get(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(v,)| v))
}

pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    let ts = now();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(&ts)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_many(pool: &SqlitePool, entries: &[(String, String)]) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let ts = now();
    for (key, value) in entries {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn all_excluding_prefixes<'e, E>(
    executor: E,
    prefixes: &[&str],
) -> AppResult<Vec<(String, String, String)>>
where
    E: Executor<'e, Database = Sqlite>,
{
    let clause = prefixes
        .iter()
        .map(|_| "key NOT LIKE ?")
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!("SELECT key, value, updated_at FROM settings WHERE {clause} ORDER BY key");
    let mut query = sqlx::query_as(sqlx::AssertSqlSafe(sql));
    for prefix in prefixes {
        query = query.bind(format!("{prefix}%"));
    }
    let rows: Vec<(String, String, String)> = query.fetch_all(executor).await?;
    Ok(rows)
}
