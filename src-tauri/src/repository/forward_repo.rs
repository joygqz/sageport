use sqlx::SqlitePool;

use crate::domain::{forward_kind, new_id, now, PortForward, PortForwardInput};
use crate::error::{AppError, AppResult};

fn normalize(mut input: PortForwardInput) -> AppResult<PortForwardInput> {
    input.label = input.label.trim().to_string();
    input.bind_host = input.bind_host.trim().to_string();
    if input.bind_host.is_empty() {
        input.bind_host = "127.0.0.1".to_string();
    }
    input.target_host = input
        .target_host
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if input.label.is_empty() {
        return Err(AppError::Invalid("forward label is required".into()));
    }
    if !(1..=65535).contains(&input.bind_port) {
        return Err(AppError::Invalid(
            "bind port must be between 1 and 65535".into(),
        ));
    }
    match input.kind.as_str() {
        forward_kind::LOCAL => {
            if input.target_host.is_none()
                || !input.target_port.is_some_and(|p| (1..=65535).contains(&p))
            {
                return Err(AppError::Invalid(
                    "local forwards need a target host and port".into(),
                ));
            }
        }
        forward_kind::DYNAMIC => {
            input.target_host = None;
            input.target_port = None;
        }
        other => return Err(AppError::Invalid(format!("unknown forward kind: {other}"))),
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<PortForward>> {
    let rows = sqlx::query_as::<_, PortForward>(
        "SELECT * FROM port_forwards WHERE deleted_at IS NULL ORDER BY label COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<PortForward> {
    sqlx::query_as::<_, PortForward>(
        "SELECT * FROM port_forwards WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("port forward {id}")))
}

pub async fn list_auto_start(pool: &SqlitePool) -> AppResult<Vec<PortForward>> {
    let rows = sqlx::query_as::<_, PortForward>(
        "SELECT * FROM port_forwards WHERE deleted_at IS NULL AND auto_start = 1",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create(pool: &SqlitePool, input: PortForwardInput) -> AppResult<PortForward> {
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO port_forwards
           (id, host_id, label, kind, bind_host, bind_port, target_host, target_port,
            auto_start, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.host_id)
    .bind(&input.label)
    .bind(&input.kind)
    .bind(&input.bind_host)
    .bind(input.bind_port)
    .bind(&input.target_host)
    .bind(input.target_port)
    .bind(input.auto_start as i64)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    input: PortForwardInput,
) -> AppResult<PortForward> {
    let input = normalize(input)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE port_forwards SET
           host_id = ?, label = ?, kind = ?, bind_host = ?, bind_port = ?,
           target_host = ?, target_port = ?, auto_start = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.host_id)
    .bind(&input.label)
    .bind(&input.kind)
    .bind(&input.bind_host)
    .bind(input.bind_port)
    .bind(&input.target_host)
    .bind(input.target_port)
    .bind(input.auto_start as i64)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("port forward {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE port_forwards
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
        return Err(AppError::NotFound(format!("port forward {id}")));
    }
    Ok(())
}
