use std::collections::HashSet;

use sqlx::{SqliteConnection, SqlitePool};

use crate::domain::{new_id, now, Group, GroupInput};
use crate::error::{AppError, AppResult};

fn normalize(mut input: GroupInput) -> AppResult<GroupInput> {
    input.name = input.name.trim().to_string();
    input.parent_id = input
        .parent_id
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if input.name.is_empty() {
        return Err(AppError::Invalid("group name is required".into()));
    }
    Ok(input)
}

async fn validate_parent(
    connection: &mut SqliteConnection,
    group_id: Option<&str>,
    parent_id: Option<&str>,
) -> AppResult<()> {
    let Some(mut current_id) = parent_id.map(str::to_string) else {
        return Ok(());
    };
    let mut visited = HashSet::new();
    if let Some(id) = group_id {
        visited.insert(id.to_string());
    }
    loop {
        if !visited.insert(current_id.clone()) {
            return Err(AppError::Invalid(
                "the group parent chain has a loop".into(),
            ));
        }
        let current: Option<(Option<String>,)> =
            sqlx::query_as("SELECT parent_id FROM groups WHERE id = ? AND deleted_at IS NULL")
                .bind(&current_id)
                .fetch_optional(&mut *connection)
                .await?;
        let current = current.ok_or_else(|| AppError::NotFound(format!("group {current_id}")))?;
        match current.0 {
            Some(parent) => current_id = parent,
            None => return Ok(()),
        }
    }
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Group>> {
    let rows = sqlx::query_as::<_, Group>(
        "SELECT * FROM groups WHERE deleted_at IS NULL ORDER BY sort_order, name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Group> {
    sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))
}

pub async fn create(pool: &SqlitePool, input: GroupInput) -> AppResult<Group> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    validate_parent(&mut tx, None, input.parent_id.as_deref()).await?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO groups (id, name, parent_id, sort_order, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(input.sort_order)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    let group =
        sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    tx.commit().await?;
    Ok(group)
}

pub async fn update(pool: &SqlitePool, id: &str, input: GroupInput) -> AppResult<Group> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM groups WHERE id = ? AND deleted_at IS NULL)",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(AppError::NotFound(format!("group {id}")));
    }
    validate_parent(&mut tx, Some(id), input.parent_id.as_deref()).await?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE groups
         SET name = ?, parent_id = ?, sort_order = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.parent_id)
    .bind(input.sort_order)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("group {id}")));
    }
    let group =
        sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    tx.commit().await?;
    Ok(group)
}

pub async fn delete(pool: &SqlitePool, id: &str, delete_hosts: bool) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let group =
        sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    let ts = now();
    if delete_hosts {
        let external_jump_users: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM hosts AS dependent
             JOIN hosts AS jump ON dependent.jump_host_id = jump.id
             WHERE jump.group_id = ?
               AND jump.deleted_at IS NULL
               AND dependent.deleted_at IS NULL
               AND (dependent.group_id IS NULL OR dependent.group_id != ?)",
        )
        .bind(id)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if external_jump_users > 0 {
            return Err(AppError::InUse(format!(
                "hosts in this group are still used as jump hosts by {external_jump_users} host{} outside the group; reassign them before deleting the group",
                if external_jump_users == 1 { "" } else { "s" }
            )));
        }
        let forwards: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)
             FROM port_forwards AS forward
             JOIN hosts AS host ON host.id = forward.host_id
             WHERE host.group_id = ?
               AND host.deleted_at IS NULL
               AND forward.deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if forwards > 0 {
            return Err(AppError::InUse(format!(
                "hosts in this group are still used by {forwards} port forward{}; delete them before deleting the group",
                if forwards == 1 { "" } else { "s" }
            )));
        }
        sqlx::query(
            "UPDATE sftp_bookmarks
             SET deleted_at = ?, updated_at = ?, revision = revision + 1
             WHERE deleted_at IS NULL
               AND host_id IN (
                 SELECT id FROM hosts WHERE group_id = ? AND deleted_at IS NULL
               )",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE hosts SET deleted_at = ?, updated_at = ?, revision = revision + 1
             WHERE group_id = ? AND deleted_at IS NULL",
        )
        .bind(&ts)
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE hosts SET group_id = NULL, updated_at = ?, revision = revision + 1
             WHERE group_id = ? AND deleted_at IS NULL",
        )
        .bind(&ts)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "UPDATE groups
         SET parent_id = ?, updated_at = ?, revision = revision + 1
         WHERE parent_id = ? AND deleted_at IS NULL",
    )
    .bind(&group.parent_id)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    let affected = sqlx::query(
        "UPDATE groups
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("group {id}")));
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::{auth, forward_kind, HostInput, PortForwardInput};
    use crate::repository::{forward_repo, host_repo};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn group_input(name: &str, parent_id: Option<String>) -> GroupInput {
        GroupInput {
            name: name.to_string(),
            parent_id,
            sort_order: 0,
        }
    }

    fn host_input(label: &str, group_id: Option<String>) -> HostInput {
        HostInput {
            label: label.to_string(),
            address: format!("{label}.example.com"),
            port: 22,
            group_id,
            identity_id: None,
            username: Some("root".to_string()),
            auth_type: Some(auth::AGENT.to_string()),
            key_id: None,
            os_hint: None,
            requires_approval: false,
            notes: None,
            jump_host_id: None,
            startup_command: None,
            password: None,
        }
    }

    #[tokio::test]
    async fn rejects_parent_cycles_and_promotes_children_when_parent_is_deleted() {
        let pool = test_pool().await;
        let parent = create(&pool, group_input("parent", None)).await.unwrap();
        let child = create(&pool, group_input("child", Some(parent.id.clone())))
            .await
            .unwrap();
        let host = host_repo::create(&pool, host_input("web", Some(parent.id.clone())))
            .await
            .unwrap();

        assert!(matches!(
            update(
                &pool,
                &parent.id,
                group_input("parent", Some(child.id.clone()))
            )
            .await,
            Err(AppError::Invalid(_))
        ));

        delete(&pool, &parent.id, false).await.unwrap();
        assert!(get(&pool, &parent.id).await.is_err());
        assert!(get(&pool, &child.id).await.unwrap().parent_id.is_none());
        assert!(host_repo::get(&pool, &host.id)
            .await
            .unwrap()
            .group_id
            .is_none());
    }

    #[tokio::test]
    async fn blocks_group_host_deletion_when_jump_hosts_are_used_outside() {
        let pool = test_pool().await;
        let group = create(&pool, group_input("jump", None)).await.unwrap();
        let jump = host_repo::create(&pool, host_input("jump", Some(group.id.clone())))
            .await
            .unwrap();
        let mut dependent_input = host_input("dependent", None);
        dependent_input.jump_host_id = Some(jump.id);
        host_repo::create(&pool, dependent_input).await.unwrap();

        assert!(matches!(
            delete(&pool, &group.id, true).await,
            Err(AppError::InUse(_))
        ));
        assert!(get(&pool, &group.id).await.is_ok());
    }

    #[tokio::test]
    async fn blocks_group_host_deletion_when_a_forward_uses_a_host() {
        let pool = test_pool().await;
        let group = create(&pool, group_input("forwarded", None)).await.unwrap();
        let host = host_repo::create(&pool, host_input("web", Some(group.id.clone())))
            .await
            .unwrap();
        forward_repo::create(
            &pool,
            PortForwardInput {
                host_id: host.id,
                label: "Web".into(),
                kind: forward_kind::LOCAL.into(),
                bind_host: "127.0.0.1".into(),
                bind_port: 18080,
                target_host: Some("127.0.0.1".into()),
                target_port: Some(8080),
                auto_start: false,
            },
        )
        .await
        .unwrap();

        assert!(matches!(
            delete(&pool, &group.id, true).await,
            Err(AppError::InUse(_))
        ));
        assert!(get(&pool, &group.id).await.is_ok());
    }
}
