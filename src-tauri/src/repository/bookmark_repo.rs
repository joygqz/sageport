use sqlx::SqlitePool;

use crate::domain::{new_id, now, SftpBookmark, SftpBookmarkInput};
use crate::error::{AppError, AppResult};

const MAX_LABEL_BYTES: usize = 255;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_HOST_ID_BYTES: usize = 128;

fn normalize(mut input: SftpBookmarkInput) -> AppResult<SftpBookmarkInput> {
    input.label = input.label.trim().to_string();
    input.path = input.path.trim().to_string();
    input.host_id = input
        .host_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if input.label.is_empty() {
        return Err(AppError::Invalid("bookmark label is required".into()));
    }
    if input.path.is_empty() {
        return Err(AppError::Invalid("bookmark path is required".into()));
    }
    if input.label.len() > MAX_LABEL_BYTES {
        return Err(AppError::Invalid(format!(
            "bookmark label exceeds {MAX_LABEL_BYTES} bytes"
        )));
    }
    if input.path.len() > MAX_PATH_BYTES || input.path.contains('\0') {
        return Err(AppError::Invalid("invalid bookmark path".into()));
    }
    if input
        .host_id
        .as_ref()
        .is_some_and(|host_id| host_id.len() > MAX_HOST_ID_BYTES)
    {
        return Err(AppError::Invalid("invalid bookmark host id".into()));
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<SftpBookmark>> {
    let rows = sqlx::query_as::<_, SftpBookmark>(
        "SELECT * FROM sftp_bookmarks WHERE deleted_at IS NULL
         ORDER BY sort_order, label COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn create(pool: &SqlitePool, input: SftpBookmarkInput) -> AppResult<SftpBookmark> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    if let Some(host_id) = input.host_id.as_deref() {
        let active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM hosts WHERE id = ? AND deleted_at IS NULL)",
        )
        .bind(host_id)
        .fetch_one(&mut *tx)
        .await?;
        if !active {
            return Err(AppError::NotFound(format!("host {host_id}")));
        }
    }
    if let Some(existing) = sqlx::query_as::<_, SftpBookmark>(
        "SELECT * FROM sftp_bookmarks
         WHERE host_id IS ? AND path = ? AND deleted_at IS NULL
         LIMIT 1",
    )
    .bind(&input.host_id)
    .bind(&input.path)
    .fetch_optional(&mut *tx)
    .await?
    {
        tx.commit().await?;
        return Ok(existing);
    }
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO sftp_bookmarks
           (id, host_id, label, path, sort_order, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, 0, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.host_id)
    .bind(&input.label)
    .bind(&input.path)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    let bookmark = sqlx::query_as::<_, SftpBookmark>(
        "SELECT * FROM sftp_bookmarks WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("bookmark {id}")))?;
    tx.commit().await?;
    Ok(bookmark)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let ts = now();
    let affected = sqlx::query(
        "UPDATE sftp_bookmarks
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
        return Err(AppError::NotFound(format!("bookmark {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{create, list, normalize};
    use crate::domain::SftpBookmarkInput;

    #[test]
    fn normalizes_and_bounds_bookmark_input() {
        let input = normalize(SftpBookmarkInput {
            host_id: Some("  ".into()),
            label: "  Home  ".into(),
            path: " /home/test ".into(),
        })
        .expect("valid bookmark");
        assert_eq!(input.host_id, None);
        assert_eq!(input.label, "Home");
        assert_eq!(input.path, "/home/test");

        assert!(normalize(SftpBookmarkInput {
            host_id: None,
            label: "x".repeat(256),
            path: "/tmp".into(),
        })
        .is_err());
    }

    #[tokio::test]
    async fn creating_the_same_scoped_path_is_idempotent() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open test database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("migrate test database");
        let input = SftpBookmarkInput {
            host_id: None,
            label: "Home".into(),
            path: "/home/test".into(),
        };

        let first = create(&pool, input.clone()).await.expect("first bookmark");
        let second = create(&pool, input).await.expect("same bookmark");

        assert_eq!(first.id, second.id);
        assert_eq!(list(&pool).await.expect("list bookmarks").len(), 1);
    }
}
