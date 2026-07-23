use std::path::Path;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sqlx::{Sqlite, SqlitePool, Transaction};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const PREFIX: &str = "sageport:secret:v1:";
const KEY_CHECK_SETTING: &str = "security.master_key_check";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_FILES: [&str; 2] = [".master-key", ".database-master-key-v1"];
const SEALED_COLUMNS: [(&str, &str); 4] = [
    ("hosts", "password"),
    ("identities", "password"),
    ("keys", "private_key"),
    ("keys", "passphrase"),
];
const SEALED_SETTINGS: [&str; 2] = ["ai.api_key", "sync.connection"];

pub async fn decrypt_sealed_values(data_dir: &Path, pool: &SqlitePool) -> AppResult<()> {
    let sealed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?)")
        .bind(KEY_CHECK_SETTING)
        .fetch_one(pool)
        .await?;
    if !sealed {
        return Ok(());
    }

    let key = load_key(data_dir).ok_or_else(|| {
        AppError::Crypto(
            "legacy encrypted credentials were preserved because their local key file is missing; restore .master-key or .database-master-key-v1 to the data directory and restart"
                .into(),
        )
    })?;
    let mut tx = pool.begin().await?;
    for (table, column) in SEALED_COLUMNS {
        decrypt_column(&mut tx, &key, table, column).await?;
    }
    for setting in SEALED_SETTINGS {
        decrypt_setting(&mut tx, &key, setting).await?;
    }
    sqlx::query("DELETE FROM settings WHERE key = ?")
        .bind(KEY_CHECK_SETTING)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    for name in KEY_FILES {
        let _ = std::fs::remove_file(data_dir.join(name));
    }
    Ok(())
}

async fn decrypt_column(
    tx: &mut Transaction<'_, Sqlite>,
    key: &[u8],
    table: &'static str,
    column: &'static str,
) -> AppResult<()> {
    let query = format!("SELECT id, {column} FROM {table} WHERE {column} LIKE '{PREFIX}%'");
    let rows: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(query))
        .fetch_all(&mut **tx)
        .await?;
    for (id, value) in rows {
        let plaintext = open(key, &format!("{table}:{id}:{column}"), &value)?;
        let update = format!("UPDATE {table} SET {column} = ? WHERE id = ?");
        sqlx::query(sqlx::AssertSqlSafe(update))
            .bind(plaintext)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

async fn decrypt_setting(
    tx: &mut Transaction<'_, Sqlite>,
    key: &[u8],
    setting: &'static str,
) -> AppResult<()> {
    let stored: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(setting)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(value) = stored.filter(|value| value.starts_with(PREFIX)) else {
        return Ok(());
    };
    let plaintext = open(key, &format!("settings:{setting}"), &value)?;
    sqlx::query("UPDATE settings SET value = ? WHERE key = ?")
        .bind(plaintext)
        .bind(setting)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn open(key: &[u8], context: &str, value: &str) -> AppResult<String> {
    let invalid = || AppError::Crypto(format!("legacy encrypted value is unreadable: {context}"));
    let encoded = value.strip_prefix(PREFIX).ok_or_else(&invalid)?;
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if bytes.len() < NONCE_LEN + 16 {
        return Err(invalid());
    }
    let (nonce, ciphertext) = bytes.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| invalid())?;
    let plaintext = cipher
        .decrypt(
            &Nonce::try_from(nonce).map_err(|_| invalid())?,
            Payload {
                msg: ciphertext,
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| invalid())?;
    String::from_utf8(plaintext).map_err(|_| invalid())
}

fn load_key(data_dir: &Path) -> Option<Zeroizing<Vec<u8>>> {
    for name in KEY_FILES {
        let path = data_dir.join(name);
        if let Ok(bytes) = std::fs::read(&path) {
            if bytes.len() == KEY_LEN {
                return Some(Zeroizing::new(bytes));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seal(key: &[u8], context: &str, plaintext: &str) -> String {
        use rand::Rng;

        let mut nonce = [0u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut nonce);
        let cipher = Aes256Gcm::new_from_slice(key).unwrap();
        let ciphertext = cipher
            .encrypt(
                &Nonce::from(nonce),
                Payload {
                    msg: plaintext.as_bytes(),
                    aad: context.as_bytes(),
                },
            )
            .unwrap();
        let mut encoded = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        encoded.extend_from_slice(&nonce);
        encoded.extend_from_slice(&ciphertext);
        format!("{PREFIX}{}", STANDARD.encode(encoded))
    }

    async fn sealed_database(dir: &Path, key: &[u8]) -> SqlitePool {
        std::fs::create_dir_all(dir).unwrap();
        let pool = crate::db::init(&dir.join("sageport.db")).await.unwrap();
        let ts = crate::domain::now();
        sqlx::query(
            "INSERT INTO hosts
             (id, label, address, port, username, auth_type, password, created_at, updated_at)
             VALUES ('h1', 'Host', 'example.com', 22, 'root', 'password', ?, ?, ?)",
        )
        .bind(seal(key, "hosts:h1:password", "hunter2"))
        .bind(&ts)
        .bind(&ts)
        .execute(&pool)
        .await
        .unwrap();
        for (setting, value) in [
            (KEY_CHECK_SETTING, "check".to_string()),
            ("ai.api_key", seal(key, "settings:ai.api_key", "sk-secret")),
        ] {
            sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
                .bind(setting)
                .bind(value)
                .bind(&ts)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool
    }

    #[tokio::test]
    async fn sealed_values_become_plaintext_and_the_key_file_is_removed() {
        let dir = std::env::temp_dir().join(format!("sageport-legacy-{}", uuid::Uuid::new_v4()));
        let key = [0x11u8; KEY_LEN];
        let pool = sealed_database(&dir, &key).await;
        std::fs::write(dir.join(KEY_FILES[0]), key).unwrap();

        decrypt_sealed_values(&dir, &pool).await.unwrap();

        let password: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'h1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(password, "hunter2");
        let api_key: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'ai.api_key'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(api_key, "sk-secret");
        assert!(!dir.join(KEY_FILES[0]).exists());

        decrypt_sealed_values(&dir, &pool).await.unwrap();
        let unchanged: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'h1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(unchanged, "hunter2");

        pool.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn missing_key_preserves_all_encrypted_values() {
        let dir =
            std::env::temp_dir().join(format!("sageport-legacy-lost-{}", uuid::Uuid::new_v4()));
        let pool = sealed_database(&dir, &[0x22u8; KEY_LEN]).await;

        let error = decrypt_sealed_values(&dir, &pool).await.unwrap_err();
        assert_eq!(error.code(), "crypto");

        let password: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'h1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(password.starts_with(PREFIX));
        let api_key: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'ai.api_key'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(api_key.starts_with(PREFIX));
        let marker_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?)")
                .bind(KEY_CHECK_SETTING)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(marker_exists);

        pool.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn unreadable_value_rolls_back_the_entire_migration() {
        let dir =
            std::env::temp_dir().join(format!("sageport-legacy-corrupt-{}", uuid::Uuid::new_v4()));
        let key = [0x33u8; KEY_LEN];
        let pool = sealed_database(&dir, &key).await;
        std::fs::write(dir.join(KEY_FILES[0]), key).unwrap();
        sqlx::query("UPDATE settings SET value = ? WHERE key = 'ai.api_key'")
            .bind(format!("{PREFIX}broken"))
            .execute(&pool)
            .await
            .unwrap();

        let error = decrypt_sealed_values(&dir, &pool).await.unwrap_err();
        assert_eq!(error.code(), "crypto");

        let password: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'h1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(password.starts_with(PREFIX));
        assert!(dir.join(KEY_FILES[0]).exists());

        pool.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }
}
