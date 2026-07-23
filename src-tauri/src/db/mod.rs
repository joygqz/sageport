use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::AppResult;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn init(path: &Path) -> AppResult<SqlitePool> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        set_private_dir_permissions(parent)?;
    }
    ensure_private_database_file(path)?;

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    MIGRATOR.run(&pool).await?;

    Ok(pool)
}

fn ensure_private_database_file(path: &Path) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    drop(options.open(path)?);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn set_private_dir_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn init_opens_databases_in_paths_with_spaces_and_special_characters() {
        let dir = std::env::temp_dir().join(format!("sageport db #%{}", uuid::Uuid::new_v4()));
        let path = dir.join("sageport.db");

        let pool = init(&path).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM hosts")
            .fetch_one(&pool)
            .await
            .unwrap();
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        let tables: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        let violations: Vec<(String, i64, String, i64)> =
            sqlx::query_as("PRAGMA foreign_key_check")
                .fetch_all(&pool)
                .await
                .unwrap();
        let host_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('hosts')")
                .fetch_all(&pool)
                .await
                .unwrap();
        pool.close().await;

        assert_eq!(count, 0);
        assert_eq!(foreign_keys, 1);
        assert_eq!(journal_mode, "wal");
        for table in [
            "groups",
            "keys",
            "identities",
            "hosts",
            "snippets",
            "settings",
            "ai_sessions",
            "sftp_transfers",
            "port_forwards",
            "sftp_bookmarks",
            "command_history",
        ] {
            assert!(tables.iter().any(|name| name == table), "missing {table}");
        }
        assert!(!host_columns.iter().any(|name| name == "requires_approval"));
        assert!(!host_columns.iter().any(|name| name == "color"));
        assert!(violations.is_empty());
        assert!(path.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn removing_host_approval_columns_preserves_host_rows() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE hosts (
                id TEXT PRIMARY KEY NOT NULL,
                label TEXT NOT NULL,
                requires_approval INTEGER NOT NULL DEFAULT 0,
                color TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO hosts (id, label, requires_approval, color)
             VALUES ('host-1', 'Production', 1, '#ef4444')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!(
            "../../migrations/0010_remove_host_ai_approval.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let host: (String, String) = sqlx::query_as("SELECT id, label FROM hosts")
            .fetch_one(&pool)
            .await
            .unwrap();
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('hosts')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(host, ("host-1".into(), "Production".into()));
        assert!(!columns.iter().any(|name| name == "requires_approval"));
        assert!(!columns.iter().any(|name| name == "color"));
    }

    #[test]
    #[cfg(unix)]
    fn database_and_parent_permissions_are_private() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("sageport-db-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = dir.join("sageport.db");
        std::fs::write(&path, b"").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        set_private_dir_permissions(&dir).unwrap();
        ensure_private_database_file(&path).unwrap();

        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
