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

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let group =
        sqlx::query_as::<_, Group>("SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("group {id}")))?;
    let ts = now();
    sqlx::query(
        "UPDATE hosts SET group_id = ?, updated_at = ?, revision = revision + 1
         WHERE group_id = ? AND deleted_at IS NULL",
    )
    .bind(&group.parent_id)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?;
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

        delete(&pool, &parent.id).await.unwrap();
        assert!(get(&pool, &parent.id).await.is_err());
        assert!(get(&pool, &child.id).await.unwrap().parent_id.is_none());
        assert!(host_repo::get(&pool, &host.id)
            .await
            .unwrap()
            .group_id
            .is_none());
    }

    #[tokio::test]
    async fn moves_hosts_and_children_to_the_deleted_groups_parent() {
        let pool = test_pool().await;
        let parent = create(&pool, group_input("parent", None)).await.unwrap();
        let group = create(&pool, group_input("nested", Some(parent.id.clone())))
            .await
            .unwrap();
        let child = create(&pool, group_input("child", Some(group.id.clone())))
            .await
            .unwrap();
        let host = host_repo::create(&pool, host_input("web", Some(group.id.clone())))
            .await
            .unwrap();

        delete(&pool, &group.id).await.unwrap();

        assert_eq!(
            host_repo::get(&pool, &host.id).await.unwrap().group_id,
            Some(parent.id.clone())
        );
        assert_eq!(
            get(&pool, &child.id).await.unwrap().parent_id,
            Some(parent.id)
        );
    }
}
