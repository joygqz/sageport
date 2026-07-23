use sqlx::{SqliteConnection, SqlitePool};

use crate::domain::{new_id, now, SshKey, SshKeyInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;
use crate::sshkey;

const MAX_NAME_LEN: usize = 255;
const MAX_PRIVATE_KEY_LEN: usize = 1024 * 1024;
const MAX_PUBLIC_KEY_LEN: usize = 1024 * 1024;
const MAX_PASSPHRASE_LEN: usize = 64 * 1024;

pub(crate) fn normalize(mut input: SshKeyInput) -> AppResult<SshKeyInput> {
    input.name = input.name.trim().to_string();
    input.public_key = input.public_key.take().map(|v| v.trim().to_string());
    input.private_key = input.private_key.take().map(|v| v.trim().to_string());

    if input.name.is_empty() {
        return Err(AppError::Invalid("key name is required".into()));
    }
    if input.name.len() > MAX_NAME_LEN || input.name.chars().any(char::is_control) {
        return Err(AppError::Invalid(format!(
            "key name exceeds {MAX_NAME_LEN} bytes"
        )));
    }
    if input.public_key.as_deref().is_some_and(|public_key| {
        public_key.len() > MAX_PUBLIC_KEY_LEN || public_key.contains('\0')
    }) {
        return Err(AppError::Invalid(format!(
            "public key exceeds {MAX_PUBLIC_KEY_LEN} bytes"
        )));
    }
    if input.private_key.as_deref().is_some_and(|private_key| {
        private_key.len() > MAX_PRIVATE_KEY_LEN || private_key.contains('\0')
    }) {
        return Err(AppError::Invalid(format!(
            "private key exceeds {MAX_PRIVATE_KEY_LEN} bytes"
        )));
    }
    if input
        .passphrase
        .as_deref()
        .is_some_and(|passphrase| passphrase.len() > MAX_PASSPHRASE_LEN)
    {
        return Err(AppError::Invalid(format!(
            "passphrase exceeds {MAX_PASSPHRASE_LEN} bytes"
        )));
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<SshKey>> {
    let rows = sqlx::query_as::<_, SshKey>(
        "SELECT * FROM keys WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<SshKey> {
    let key = sqlx::query_as::<_, SshKey>("SELECT * FROM keys WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("key {id}")))?;
    Ok(key)
}

fn with_validated_private_key(
    mut input: SshKeyInput,
    private_key_required: bool,
) -> AppResult<SshKeyInput> {
    match input
        .private_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        Some(private_key) => {
            let insight =
                sshkey::inspect(private_key, input.passphrase.as_deref())?.ok_or_else(|| {
                    AppError::Invalid("invalid or unsupported SSH private key".into())
                })?;
            // Never trust a separately supplied public key: derive it from the
            // private material so copying it cannot advertise a different key.
            input.public_key = Some(insight.public_key);
            if !insight.encrypted {
                input.passphrase = Some(String::new());
            }
        }
        None if private_key_required => {
            return Err(AppError::Invalid("private key is required".into()));
        }
        None if input.public_key.is_some() || input.passphrase.is_some() => {
            return Err(AppError::Invalid(
                "a private key is required when replacing key material".into(),
            ));
        }
        None => {}
    }
    Ok(input)
}

pub async fn create(pool: &SqlitePool, input: SshKeyInput) -> AppResult<SshKey> {
    let mut connection = pool.acquire().await?;
    create_in(&mut connection, input).await
}

pub(crate) async fn create_in(
    connection: &mut SqliteConnection,
    input: SshKeyInput,
) -> AppResult<SshKey> {
    let input = with_validated_private_key(normalize(input)?, true)?;
    let id = new_id();
    let ts = now();
    let private_key = none_if_empty(input.private_key.as_deref());
    let passphrase = none_if_empty(input.passphrase.as_deref());
    sqlx::query(
        "INSERT INTO keys (id, name, public_key, private_key, passphrase, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.public_key)
    .bind(private_key)
    .bind(passphrase)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *connection)
    .await?;

    let key = sqlx::query_as::<_, SshKey>("SELECT * FROM keys WHERE id = ? AND deleted_at IS NULL")
        .bind(&id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("key {id}")))?;
    Ok(key)
}

pub async fn update(pool: &SqlitePool, id: &str, input: SshKeyInput) -> AppResult<SshKey> {
    let input = with_validated_private_key(normalize(input)?, false)?;
    let ts = now();
    let mut tx = pool.begin().await?;
    let affected = sqlx::query(
        "UPDATE keys SET name = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("key {id}")));
    }

    if input.public_key.is_some() {
        sqlx::query("UPDATE keys SET public_key = ? WHERE id = ?")
            .bind(none_if_empty(input.public_key.as_deref()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if input.private_key.is_some() {
        let private_key = none_if_empty(input.private_key.as_deref());
        sqlx::query("UPDATE keys SET private_key = ? WHERE id = ?")
            .bind(private_key)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    if input.passphrase.is_some() {
        let passphrase = none_if_empty(input.passphrase.as_deref());
        sqlx::query("UPDATE keys SET passphrase = ? WHERE id = ?")
            .bind(passphrase)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let key = sqlx::query_as::<_, SshKey>("SELECT * FROM keys WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("key {id}")))?;
    tx.commit().await?;
    Ok(key)
}

async fn hosts_using(connection: &mut SqliteConnection, id: &str) -> AppResult<i64> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE key_id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_one(&mut *connection)
            .await?;
    Ok(count)
}

async fn identities_using(connection: &mut SqliteConnection, id: &str) -> AppResult<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identities WHERE key_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *connection)
    .await?;
    Ok(count)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let hosts = hosts_using(&mut tx, id).await?;
    let identities = identities_using(&mut tx, id).await?;
    if hosts > 0 || identities > 0 {
        let mut used_by = Vec::new();
        if hosts > 0 {
            used_by.push(format!("{hosts} host{}", if hosts == 1 { "" } else { "s" }));
        }
        if identities > 0 {
            used_by.push(format!(
                "{identities} identit{}",
                if identities == 1 { "y" } else { "ies" }
            ));
        }
        return Err(AppError::InUse(format!(
            "this key is still used by {}; reassign them before deleting it",
            used_by.join(" and ")
        )));
    }

    let ts = now();
    let affected = sqlx::query(
        "UPDATE keys
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
        return Err(AppError::NotFound(format!("key {id}")));
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::{KeyAlgorithm, SshKeyView};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn input(name: &str, private_key: Option<String>, passphrase: Option<String>) -> SshKeyInput {
        SshKeyInput {
            name: name.into(),
            public_key: Some("ssh-ed25519 mismatched-client-value".into()),
            private_key,
            passphrase,
        }
    }

    #[tokio::test]
    async fn create_validates_private_material_and_never_serializes_secrets() {
        let pool = test_pool().await;
        assert!(matches!(
            create(&pool, input("invalid", Some("not a key".into()), None)).await,
            Err(AppError::Invalid(_))
        ));

        let generated = crate::sshkey::generate(KeyAlgorithm::Ed25519, None, "key-test").unwrap();
        let key = create(&pool, input("valid", Some(generated.private_key), None))
            .await
            .unwrap();
        assert_eq!(
            key.public_key.as_deref(),
            Some(generated.public_key.as_str())
        );

        let public = serde_json::to_value(SshKeyView::from(key)).unwrap();
        assert_eq!(public["hasPrivateKey"], true);
        assert_eq!(public["hasPassphrase"], false);
        assert!(public.get("privateKey").is_none());
        assert!(public.get("passphrase").is_none());
    }

    #[tokio::test]
    async fn encrypted_private_key_requires_the_correct_passphrase() {
        let pool = test_pool().await;
        let generated =
            crate::sshkey::generate(KeyAlgorithm::Ed25519, Some("correct"), "encrypted-test")
                .unwrap();

        assert!(matches!(
            create(
                &pool,
                input("missing", Some(generated.private_key.clone()), None),
            )
            .await,
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            create(
                &pool,
                input(
                    "wrong",
                    Some(generated.private_key.clone()),
                    Some("wrong".into()),
                ),
            )
            .await,
            Err(AppError::Invalid(_))
        ));
        create(
            &pool,
            input(
                "correct",
                Some(generated.private_key),
                Some("correct".into()),
            ),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn rename_preserves_material_and_replacement_is_atomic() {
        let pool = test_pool().await;
        let first = crate::sshkey::generate(KeyAlgorithm::Ed25519, None, "first").unwrap();
        let key = create(&pool, input("first", Some(first.private_key.clone()), None))
            .await
            .unwrap();

        let renamed = update(
            &pool,
            &key.id,
            SshKeyInput {
                name: "renamed".into(),
                public_key: None,
                private_key: None,
                passphrase: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(renamed.private_key, key.private_key);
        assert_eq!(renamed.public_key, key.public_key);

        let second = crate::sshkey::generate(KeyAlgorithm::Ed25519, None, "second").unwrap();
        let replaced = update(
            &pool,
            &key.id,
            SshKeyInput {
                name: "renamed".into(),
                public_key: Some("mismatched".into()),
                private_key: Some(second.private_key.clone()),
                passphrase: Some(String::new()),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            replaced.private_key.as_deref().map(str::trim),
            Some(second.private_key.trim())
        );
        assert_eq!(
            replaced.public_key.as_deref(),
            Some(second.public_key.as_str())
        );
        assert!(replaced.passphrase.is_none());
    }
}
