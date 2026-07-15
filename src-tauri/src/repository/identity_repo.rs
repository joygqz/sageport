use sqlx::{SqliteConnection, SqlitePool};

use crate::domain::{auth, new_id, now, Identity, IdentityInput, SshKey};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;

const MAX_NAME_LEN: usize = 255;
const MAX_USERNAME_LEN: usize = 255;
const MAX_PASSWORD_LEN: usize = 64 * 1024;

fn clean_optional(value: &mut Option<String>) {
    *value = value
        .take()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
}

fn normalize(mut input: IdentityInput) -> AppResult<IdentityInput> {
    input.name = input.name.trim().to_string();
    input.username = input.username.trim().to_string();
    input.auth_type = input.auth_type.trim().to_string();
    clean_optional(&mut input.key_id);

    if input.name.is_empty() {
        return Err(AppError::Invalid("identity name is required".into()));
    }
    if input.name.len() > MAX_NAME_LEN {
        return Err(AppError::Invalid(format!(
            "identity name exceeds {MAX_NAME_LEN} bytes"
        )));
    }
    if input.username.is_empty() {
        return Err(AppError::Invalid("username is required".into()));
    }
    if input.username.len() > MAX_USERNAME_LEN {
        return Err(AppError::Invalid(format!(
            "username exceeds {MAX_USERNAME_LEN} bytes"
        )));
    }
    if input
        .password
        .as_deref()
        .is_some_and(|password| password.len() > MAX_PASSWORD_LEN)
    {
        return Err(AppError::Invalid(format!(
            "password exceeds {MAX_PASSWORD_LEN} bytes"
        )));
    }
    if !matches!(
        input.auth_type.as_str(),
        auth::PASSWORD | auth::KEY | auth::AGENT
    ) {
        return Err(AppError::Invalid(format!(
            "unknown auth type: {}",
            input.auth_type
        )));
    }

    if input.auth_type == auth::KEY {
        if input.key_id.is_none() {
            return Err(AppError::Invalid("key auth selected but no key set".into()));
        }
        input.password = Some(String::new());
    } else {
        input.key_id = None;
        if input.auth_type != auth::PASSWORD {
            input.password = Some(String::new());
        }
    }
    Ok(input)
}

async fn validate_key_reference(
    connection: &mut SqliteConnection,
    input: &IdentityInput,
) -> AppResult<()> {
    let Some(key_id) = input.key_id.as_deref() else {
        return Ok(());
    };
    let key = sqlx::query_as::<_, SshKey>("SELECT * FROM keys WHERE id = ? AND deleted_at IS NULL")
        .bind(key_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or_else(|| AppError::Invalid("the selected SSH key does not exist".into()))?;
    let private_key = key
        .private_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Invalid("the selected SSH key has no private key".into()))?;
    let valid = crate::sshkey::inspect(private_key, key.passphrase.as_deref())?;
    if valid.is_none() {
        return Err(AppError::Invalid(
            "the selected SSH key is invalid or unsupported".into(),
        ));
    }
    Ok(())
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Identity>> {
    let rows = sqlx::query_as::<_, Identity>(
        "SELECT * FROM identities WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Identity> {
    sqlx::query_as::<_, Identity>("SELECT * FROM identities WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("identity {id}")))
}

pub async fn create(pool: &SqlitePool, input: IdentityInput) -> AppResult<Identity> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    validate_key_reference(&mut tx, &input).await?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO identities
           (id, name, username, auth_type, key_id, password, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(none_if_empty(input.password.as_deref()))
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    let identity = sqlx::query_as::<_, Identity>(
        "SELECT * FROM identities WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("identity {id}")))?;
    tx.commit().await?;
    Ok(identity)
}

pub async fn update(pool: &SqlitePool, id: &str, input: IdentityInput) -> AppResult<Identity> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    validate_key_reference(&mut tx, &input).await?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE identities SET
           name = ?, username = ?, auth_type = ?, key_id = ?,
           updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.username)
    .bind(&input.auth_type)
    .bind(&input.key_id)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("identity {id}")));
    }

    if input.password.is_some() {
        sqlx::query("UPDATE identities SET password = ? WHERE id = ?")
            .bind(none_if_empty(input.password.as_deref()))
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let identity = sqlx::query_as::<_, Identity>(
        "SELECT * FROM identities WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("identity {id}")))?;
    tx.commit().await?;
    Ok(identity)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let in_use: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM hosts WHERE identity_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    if in_use > 0 {
        return Err(AppError::InUse(format!(
            "this identity is still used by {in_use} host{}; reassign them before deleting it",
            if in_use == 1 { "" } else { "s" }
        )));
    }

    let ts = now();
    let affected = sqlx::query(
        "UPDATE identities
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
        return Err(AppError::NotFound(format!("identity {id}")));
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::domain::{HostInput, IdentityView, KeyAlgorithm, SshKeyInput};
    use crate::repository::{host_repo, key_repo};

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn input(auth_type: &str, key_id: Option<String>, password: Option<String>) -> IdentityInput {
        IdentityInput {
            name: "Production root".into(),
            username: "root".into(),
            auth_type: auth_type.into(),
            key_id,
            password,
        }
    }

    async fn create_key(pool: &SqlitePool) -> crate::domain::SshKey {
        let generated =
            crate::sshkey::generate(KeyAlgorithm::Ed25519, None, "identity-test").unwrap();
        key_repo::create(
            pool,
            SshKeyInput {
                name: "identity-key".into(),
                public_key: None,
                private_key: Some(generated.private_key),
                passphrase: None,
            },
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn password_update_distinguishes_keep_replace_and_clear_without_serializing_secret() {
        let pool = test_pool().await;
        let identity = create(&pool, input(auth::PASSWORD, None, Some("secret".into())))
            .await
            .unwrap();

        let kept = update(&pool, &identity.id, input(auth::PASSWORD, None, None))
            .await
            .unwrap();
        assert_eq!(kept.password.as_deref(), Some("secret"));
        let public = serde_json::to_value(IdentityView::from(kept.clone())).unwrap();
        assert_eq!(public["hasPassword"], true);
        assert!(public.get("password").is_none());

        let replaced = update(
            &pool,
            &identity.id,
            input(auth::PASSWORD, None, Some("replacement".into())),
        )
        .await
        .unwrap();
        assert_eq!(replaced.password.as_deref(), Some("replacement"));

        let cleared = update(
            &pool,
            &identity.id,
            input(auth::PASSWORD, None, Some(String::new())),
        )
        .await
        .unwrap();
        assert!(cleared.password.is_none());
    }

    #[tokio::test]
    async fn key_auth_requires_an_active_key_with_private_material() {
        let pool = test_pool().await;
        assert!(matches!(
            create(&pool, input(auth::KEY, None, None)).await,
            Err(AppError::Invalid(_))
        ));

        let key = create_key(&pool).await;
        let identity = create(&pool, input(auth::KEY, Some(key.id.clone()), None))
            .await
            .unwrap();
        assert_eq!(identity.key_id.as_deref(), Some(key.id.as_str()));
        assert!(matches!(
            key_repo::delete(&pool, &key.id).await,
            Err(AppError::InUse(_))
        ));

        delete(&pool, &identity.id).await.unwrap();
        key_repo::delete(&pool, &key.id).await.unwrap();
        assert!(matches!(
            create(&pool, input(auth::KEY, Some(key.id), None)).await,
            Err(AppError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn identity_in_use_by_an_active_host_cannot_be_deleted() {
        let pool = test_pool().await;
        let identity = create(&pool, input(auth::AGENT, None, None)).await.unwrap();
        host_repo::create(
            &pool,
            HostInput {
                label: "web".into(),
                address: "web.example.com".into(),
                port: 22,
                group_id: None,
                identity_id: Some(identity.id.clone()),
                username: None,
                auth_type: None,
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
        .unwrap();

        assert!(matches!(
            delete(&pool, &identity.id).await,
            Err(AppError::InUse(_))
        ));
    }
}
