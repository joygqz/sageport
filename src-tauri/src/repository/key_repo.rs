use sqlx::SqlitePool;

use crate::domain::{new_id, now, SshKey, SshKeyInput};
use crate::error::{AppError, AppResult};
use crate::repository::none_if_empty;
use crate::sshkey;

fn normalize(mut input: SshKeyInput) -> AppResult<SshKeyInput> {
    input.name = input.name.trim().to_string();
    input.public_key = input.public_key.take().map(|v| v.trim().to_string());
    input.private_key = input.private_key.take().map(|v| v.trim().to_string());

    if input.name.is_empty() {
        return Err(AppError::Invalid("key name is required".into()));
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
    sqlx::query_as::<_, SshKey>("SELECT * FROM keys WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("key {id}")))
}

/// Fill in `public_key` from the private key when the caller didn't supply
/// one — e.g. a manually pasted/imported OpenSSH key with no sibling `.pub`
/// file. Leaves unparseable key material untouched.
fn with_derived_public_key(mut input: SshKeyInput) -> AppResult<SshKeyInput> {
    if input.public_key.is_none() {
        if let Some(private_key) = input.private_key.as_deref() {
            if let Some(insight) = sshkey::inspect(private_key, input.passphrase.as_deref())? {
                input.public_key = Some(insight.public_key);
            }
        }
    }
    Ok(input)
}

pub async fn create(pool: &SqlitePool, input: SshKeyInput) -> AppResult<SshKey> {
    let input = with_derived_public_key(normalize(input)?)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO keys (id, name, public_key, private_key, passphrase, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.public_key)
    .bind(none_if_empty(input.private_key.as_deref()))
    .bind(none_if_empty(input.passphrase.as_deref()))
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;

    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: SshKeyInput) -> AppResult<SshKey> {
    // Re-derive the public key when a new private key is sent without one,
    // same as `create` — otherwise re-uploading just the private key would
    // leave a stale public key behind.
    let input = with_derived_public_key(normalize(input)?)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE keys SET name = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("key {id}")));
    }

    // Only touch secret/derived material when explicitly sent (or derived
    // above); an empty string clears it, `None` leaves it untouched.
    if input.public_key.is_some() {
        sqlx::query("UPDATE keys SET public_key = ? WHERE id = ?")
            .bind(none_if_empty(input.public_key.as_deref()))
            .bind(id)
            .execute(pool)
            .await?;
    }
    if input.private_key.is_some() {
        sqlx::query("UPDATE keys SET private_key = ? WHERE id = ?")
            .bind(none_if_empty(input.private_key.as_deref()))
            .bind(id)
            .execute(pool)
            .await?;
    }
    if input.passphrase.is_some() {
        sqlx::query("UPDATE keys SET passphrase = ? WHERE id = ?")
            .bind(none_if_empty(input.passphrase.as_deref()))
            .bind(id)
            .execute(pool)
            .await?;
    }

    get(pool, id).await
}

async fn hosts_using(pool: &SqlitePool, id: &str) -> AppResult<i64> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM hosts WHERE key_id = ? AND deleted_at IS NULL")
            .bind(id)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

async fn identities_using(pool: &SqlitePool, id: &str) -> AppResult<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM identities WHERE key_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let hosts = hosts_using(pool, id).await?;
    let identities = identities_using(pool, id).await?;
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
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("key {id}")));
    }
    Ok(())
}
