use sqlx::SqlitePool;

use crate::domain::{new_id, now, Snippet, SnippetInput};
use crate::error::{AppError, AppResult};

const MAX_ID_BYTES: usize = 128;
const MAX_NAME_CHARS: usize = 255;
const MAX_COMMAND_CHARS: usize = 32 * 1024;
const MAX_DESCRIPTION_CHARS: usize = 4 * 1024;

fn normalize(mut input: SnippetInput) -> AppResult<SnippetInput> {
    input.name = input.name.trim().to_string();
    input.command = input.command.trim().to_string();
    input.description = input
        .description
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if input.name.is_empty() {
        return Err(AppError::Invalid("snippet name is required".into()));
    }
    if input.command.is_empty() {
        return Err(AppError::Invalid("snippet command is required".into()));
    }
    if input.name.chars().count() > MAX_NAME_CHARS || input.name.contains('\0') {
        return Err(AppError::Invalid(format!(
            "snippet name exceeds {MAX_NAME_CHARS} characters"
        )));
    }
    if input.command.chars().count() > MAX_COMMAND_CHARS || input.command.contains('\0') {
        return Err(AppError::Invalid(format!(
            "snippet command exceeds {MAX_COMMAND_CHARS} characters"
        )));
    }
    if input
        .description
        .as_ref()
        .is_some_and(|value| value.chars().count() > MAX_DESCRIPTION_CHARS || value.contains('\0'))
    {
        return Err(AppError::Invalid(format!(
            "snippet description exceeds {MAX_DESCRIPTION_CHARS} characters"
        )));
    }
    Ok(input)
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES {
        return Err(AppError::Invalid("invalid snippet id".into()));
    }
    Ok(())
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Snippet>> {
    let rows = sqlx::query_as::<_, Snippet>(
        "SELECT * FROM snippets WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Snippet> {
    validate_id(id)?;
    sqlx::query_as::<_, Snippet>("SELECT * FROM snippets WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("snippet {id}")))
}

pub async fn create(pool: &SqlitePool, input: SnippetInput) -> AppResult<Snippet> {
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO snippets (id, name, command, description, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.command)
    .bind(&input.description)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: SnippetInput) -> AppResult<Snippet> {
    validate_id(id)?;
    let input = normalize(input)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE snippets SET name = ?, command = ?, description = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.command)
    .bind(&input.description)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("snippet {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE snippets
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
        return Err(AppError::NotFound(format!("snippet {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    fn input(name: &str, command: &str) -> SnippetInput {
        SnippetInput {
            name: name.into(),
            command: command.into(),
            description: Some("  useful command  ".into()),
        }
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[test]
    fn normalizes_and_bounds_snippet_input() {
        let normalized = normalize(input("  Deploy  ", "  echo ok  ")).unwrap();
        assert_eq!(normalized.name, "Deploy");
        assert_eq!(normalized.command, "echo ok");
        assert_eq!(normalized.description.as_deref(), Some("useful command"));

        assert!(normalize(input(&"x".repeat(MAX_NAME_CHARS + 1), "echo ok")).is_err());
        assert!(normalize(input("Deploy", &"x".repeat(MAX_COMMAND_CHARS + 1))).is_err());
        assert!(normalize(input(&"命".repeat(MAX_NAME_CHARS), "echo ok")).is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id(&"x".repeat(MAX_ID_BYTES + 1)).is_err());
    }

    #[tokio::test]
    async fn creates_updates_and_soft_deletes_snippets() {
        let pool = test_pool().await;
        let created = create(&pool, input("Deploy", "echo one")).await.unwrap();
        let updated = update(&pool, &created.id, input("Deploy now", "echo two"))
            .await
            .unwrap();
        assert_eq!(updated.command, "echo two");
        assert_eq!(updated.revision, 2);

        delete(&pool, &created.id).await.unwrap();
        assert!(get(&pool, &created.id).await.is_err());
        assert!(list(&pool).await.unwrap().is_empty());
        assert!(delete(&pool, &created.id).await.is_err());
    }
}
