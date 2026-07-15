use std::collections::HashSet;

use sqlx::{SqliteConnection, SqlitePool};

use crate::domain::{auth, new_id, now, Host, HostInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;
use crate::ssh::JUMP_DEPTH_LIMIT;

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
    if input.identity_id.is_none() && input.auth_type.is_none() {
        input.auth_type = Some(auth::PASSWORD.to_string());
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
        if input.username.is_none() {
            return Err(AppError::Invalid("username is required".into()));
        }
        if input.auth_type.as_deref() == Some(auth::KEY) && input.key_id.is_none() {
            return Err(AppError::Invalid("key auth selected but no key set".into()));
        }
        if input.auth_type.as_deref() != Some(auth::KEY) {
            input.key_id = None;
        }
        if input.auth_type.as_deref() != Some(auth::PASSWORD) {
            input.password = Some(String::new());
        }
    }
    Ok(input)
}

async fn validate_references(
    pool: &SqlitePool,
    host_id: Option<&str>,
    input: &HostInput,
) -> AppResult<()> {
    if let Some(group_id) = input.group_id.as_deref() {
        crate::repository::group_repo::get(pool, group_id).await?;
    }
    if let Some(identity_id) = input.identity_id.as_deref() {
        crate::repository::identity_repo::get(pool, identity_id).await?;
    }
    if input.identity_id.is_none() && input.auth_type.as_deref() == Some(auth::KEY) {
        let key_id = input
            .key_id
            .as_deref()
            .ok_or_else(|| AppError::Invalid("key auth selected but no key set".into()))?;
        let key = crate::repository::key_repo::get(pool, key_id).await?;
        if key.private_key.as_deref().is_none_or(str::is_empty) {
            return Err(AppError::Invalid(
                "the selected SSH key has no private key".into(),
            ));
        }
    }

    let Some(mut jump_id) = input.jump_host_id.clone() else {
        return Ok(());
    };
    let mut visited = HashSet::new();
    if let Some(id) = host_id {
        visited.insert(id.to_string());
    }
    let mut depth = 1usize;
    loop {
        if !visited.insert(jump_id.clone()) {
            return Err(AppError::Invalid("the jump host chain has a loop".into()));
        }
        depth += 1;
        if depth > JUMP_DEPTH_LIMIT {
            return Err(AppError::Invalid("the jump host chain is too deep".into()));
        }
        let jump = get(pool, &jump_id).await?;
        match jump.jump_host_id {
            Some(next) => jump_id = next,
            None => break,
        }
    }
    Ok(())
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
    validate_references(pool, None, &input).await?;
    let mut connection = pool.acquire().await?;
    create_normalized_in(&mut connection, input).await
}

pub(crate) async fn create_in(
    connection: &mut SqliteConnection,
    input: HostInput,
) -> AppResult<Host> {
    let input = normalize(input)?;
    create_normalized_in(connection, input).await
}

async fn create_normalized_in(
    connection: &mut SqliteConnection,
    input: HostInput,
) -> AppResult<Host> {
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
    .execute(&mut *connection)
    .await?;

    sqlx::query_as::<_, Host>("SELECT * FROM hosts WHERE id = ? AND deleted_at IS NULL")
        .bind(&id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("host {id}")))
}

pub async fn update(pool: &SqlitePool, id: &str, input: HostInput) -> AppResult<Host> {
    let input = normalize(input)?;
    validate_references(pool, Some(id), &input).await?;
    let ts = now();
    let mut tx = pool.begin().await?;
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
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("host {id}")));
    }

    if input.password.is_some() {
        sqlx::query("UPDATE hosts SET password = ? WHERE id = ?")
            .bind(none_if_empty(input.password.as_deref()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let host = sqlx::query_as::<_, Host>("SELECT * FROM hosts WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("host {id}")))?;
    tx.commit().await?;
    Ok(host)
}

pub async fn move_to_group(
    pool: &SqlitePool,
    id: &str,
    group_id: Option<String>,
) -> AppResult<Host> {
    let group_id = group_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if let Some(gid) = group_id.as_deref() {
        crate::repository::group_repo::get(pool, gid).await?;
    }
    let ts = now();
    let affected = sqlx::query(
        "UPDATE hosts SET group_id = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&group_id)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("host {id}")));
    }
    get(pool, id).await
}

pub async fn set_os_hint(pool: &SqlitePool, id: &str, os_hint: String) -> AppResult<Host> {
    let os_hint = os_hint.trim();
    if os_hint.is_empty() {
        return Err(AppError::Invalid("host system is required".into()));
    }

    let ts = now();
    let affected = sqlx::query(
        "UPDATE hosts SET os_hint = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(os_hint)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("host {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    get(pool, id).await?;
    let dependents: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hosts
         WHERE jump_host_id = ? AND deleted_at IS NULL AND id != ?",
    )
    .bind(id)
    .bind(id)
    .fetch_one(pool)
    .await?;
    if dependents > 0 {
        return Err(AppError::InUse(format!(
            "this host is still used as a jump host by {dependents} host{}; reassign them before deleting it",
            if dependents == 1 { "" } else { "s" }
        )));
    }
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

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::HostView;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn input(label: &str) -> HostInput {
        HostInput {
            label: label.to_string(),
            address: format!("{label}.example.com"),
            port: 22,
            group_id: None,
            identity_id: None,
            username: Some("root".to_string()),
            auth_type: Some(auth::AGENT.to_string()),
            key_id: None,
            os_hint: None,
            color: None,
            notes: None,
            jump_host_id: None,
            startup_command: None,
            password: None,
        }
    }

    fn update_input(host: &Host, password: Option<String>) -> HostInput {
        HostInput {
            label: host.label.clone(),
            address: host.address.clone(),
            port: host.port,
            group_id: host.group_id.clone(),
            identity_id: host.identity_id.clone(),
            username: host.username.clone(),
            auth_type: host.auth_type.clone(),
            key_id: host.key_id.clone(),
            os_hint: host.os_hint.clone(),
            color: host.color.clone(),
            notes: host.notes.clone(),
            jump_host_id: host.jump_host_id.clone(),
            startup_command: host.startup_command.clone(),
            password,
        }
    }

    #[tokio::test]
    async fn password_update_distinguishes_keep_and_clear_and_public_view_hides_secret() {
        let pool = test_pool().await;
        let mut create_input = input("web");
        create_input.auth_type = Some(auth::PASSWORD.to_string());
        create_input.password = Some("secret".to_string());
        let host = create(&pool, create_input).await.unwrap();

        let kept = update(&pool, &host.id, update_input(&host, None))
            .await
            .unwrap();
        assert_eq!(kept.password.as_deref(), Some("secret"));
        let public = serde_json::to_value(HostView::from(kept.clone())).unwrap();
        assert_eq!(public["hasPassword"], true);
        assert!(public.get("password").is_none());

        let cleared = update(&pool, &host.id, update_input(&kept, Some(String::new())))
            .await
            .unwrap();
        assert!(cleared.password.is_none());
    }

    #[tokio::test]
    async fn rejects_incomplete_authentication_configuration() {
        let pool = test_pool().await;
        let mut missing_username = input("missing-user");
        missing_username.username = None;
        assert!(matches!(
            create(&pool, missing_username).await,
            Err(AppError::Invalid(_))
        ));

        let mut missing_key = input("missing-key");
        missing_key.auth_type = Some(auth::KEY.to_string());
        assert!(matches!(
            create(&pool, missing_key).await,
            Err(AppError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn rejects_jump_cycles_and_protects_jump_hosts_from_deletion() {
        let pool = test_pool().await;
        let first = create(&pool, input("first")).await.unwrap();
        let mut second_input = input("second");
        second_input.jump_host_id = Some(first.id.clone());
        let second = create(&pool, second_input).await.unwrap();

        let mut cyclic = update_input(&first, None);
        cyclic.jump_host_id = Some(second.id.clone());
        assert!(matches!(
            update(&pool, &first.id, cyclic).await,
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            delete(&pool, &first.id).await,
            Err(AppError::InUse(_))
        ));
    }
}
