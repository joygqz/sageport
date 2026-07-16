use sqlx::SqlitePool;

use crate::domain::{forward_kind, new_id, now, PortForward, PortForwardInput};
use crate::error::{AppError, AppResult};

const MAX_ID_BYTES: usize = 128;
const MAX_LABEL_BYTES: usize = 255;
const MAX_HOST_BYTES: usize = 255;

fn normalize(mut input: PortForwardInput) -> AppResult<PortForwardInput> {
    input.host_id = input.host_id.trim().to_string();
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
    if input.host_id.is_empty() || input.host_id.len() > MAX_ID_BYTES {
        return Err(AppError::Invalid("invalid forward host id".into()));
    }
    if input.label.len() > MAX_LABEL_BYTES {
        return Err(AppError::Invalid(format!(
            "forward label exceeds {MAX_LABEL_BYTES} bytes"
        )));
    }
    if input.bind_host.len() > MAX_HOST_BYTES || input.bind_host.contains('\0') {
        return Err(AppError::Invalid("invalid forward bind address".into()));
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
            if input
                .target_host
                .as_ref()
                .is_some_and(|host| host.len() > MAX_HOST_BYTES || host.contains('\0'))
            {
                return Err(AppError::Invalid("invalid forward target host".into()));
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
    let mut tx = pool.begin().await?;
    require_active_host(&mut tx, &input.host_id).await?;
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
    .execute(&mut *tx)
    .await?;
    let forward = get_in(&mut tx, &id).await?;
    tx.commit().await?;
    Ok(forward)
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    input: PortForwardInput,
) -> AppResult<PortForward> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    require_active_host(&mut tx, &input.host_id).await?;
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
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("port forward {id}")));
    }
    let forward = get_in(&mut tx, id).await?;
    tx.commit().await?;
    Ok(forward)
}

async fn require_active_host(
    connection: &mut sqlx::SqliteConnection,
    host_id: &str,
) -> AppResult<()> {
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ? AND deleted_at IS NULL)",
    )
    .bind(host_id)
    .fetch_one(&mut *connection)
    .await?;
    if !active {
        return Err(AppError::NotFound(format!("host {host_id}")));
    }
    Ok(())
}

async fn get_in(connection: &mut sqlx::SqliteConnection, id: &str) -> AppResult<PortForward> {
    sqlx::query_as::<_, PortForward>(
        "SELECT * FROM port_forwards WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(connection)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("port forward {id}")))
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

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::{auth, HostInput};
    use crate::repository::host_repo;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn host(pool: &SqlitePool) -> crate::domain::Host {
        host_repo::create(
            pool,
            HostInput {
                label: "Gateway".into(),
                address: "gateway.example.com".into(),
                port: 22,
                group_id: None,
                identity_id: None,
                username: Some("root".into()),
                auth_type: Some(auth::AGENT.into()),
                key_id: None,
                os_hint: None,
                color: None,
                notes: None,
                jump_host_id: None,
                startup_command: None,
                password: None,
            },
        )
        .await
        .unwrap()
    }

    fn input(host_id: String, kind: &str) -> PortForwardInput {
        PortForwardInput {
            host_id,
            label: " Database ".into(),
            kind: kind.into(),
            bind_host: " 127.0.0.1 ".into(),
            bind_port: 15432,
            target_host: Some(" db.internal ".into()),
            target_port: Some(5432),
            auto_start: false,
        }
    }

    #[test]
    fn normalizes_and_bounds_forward_input() {
        let normalized = normalize(input(" host ".into(), forward_kind::LOCAL)).unwrap();
        assert_eq!(normalized.host_id, "host");
        assert_eq!(normalized.label, "Database");
        assert_eq!(normalized.bind_host, "127.0.0.1");
        assert_eq!(normalized.target_host.as_deref(), Some("db.internal"));

        let mut invalid = input("host".into(), forward_kind::LOCAL);
        invalid.bind_port = 0;
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));

        let mut dynamic = input("host".into(), forward_kind::DYNAMIC);
        dynamic.target_port = Some(0);
        let dynamic = normalize(dynamic).unwrap();
        assert!(dynamic.target_host.is_none());
        assert!(dynamic.target_port.is_none());
    }

    #[tokio::test]
    async fn requires_an_active_host_and_protects_it_from_deletion() {
        let pool = test_pool().await;
        assert!(matches!(
            create(&pool, input("missing".into(), forward_kind::LOCAL)).await,
            Err(AppError::NotFound(_))
        ));

        let host = host(&pool).await;
        let forward = create(&pool, input(host.id.clone(), forward_kind::LOCAL))
            .await
            .unwrap();
        assert_eq!(forward.host_id, host.id);
        assert!(matches!(
            host_repo::delete(&pool, &host.id).await,
            Err(AppError::InUse(_))
        ));

        delete(&pool, &forward.id).await.unwrap();
        host_repo::delete(&pool, &host.id).await.unwrap();
        assert!(matches!(
            create(&pool, input(host.id, forward_kind::LOCAL)).await,
            Err(AppError::NotFound(_))
        ));
    }
}
