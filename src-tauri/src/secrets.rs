use std::path::Path;
use std::sync::OnceLock;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::Rng;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Sqlite, SqlitePool, Transaction};
use zeroize::Zeroizing;

use crate::domain::{Host, Identity, SshKey};
use crate::error::{AppError, AppResult};

const SERVICE: &str = "com.sageport.desktop";
const ACCOUNT: &str = "database-master-key-v1";
const PREFIX: &str = "sageport:secret:v1:";
const KEY_CHECK_SETTING: &str = "security.master_key_check";
const KEY_CHECK_VALUE: &str = "sageport-database-key-v1";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
#[cfg(target_os = "macos")]
const DEV_KEY_FILE: &str = ".database-master-key-v1";

static MASTER_KEY: OnceLock<Zeroizing<[u8; KEY_LEN]>> = OnceLock::new();

/// Loads the per-installation database key. Production builds read it directly
/// from the operating-system credential store. An unsigned macOS development
/// build uses a private application-data key file because every rebuild has a
/// different ad-hoc code signature and would otherwise prompt again. Existing
/// encrypted development databases import their original Keychain key once.
pub fn initialize(data_dir: &Path, allow_create: bool) -> AppResult<()> {
    if MASTER_KEY.get().is_some() {
        return Ok(());
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    let bytes = load_development_key(data_dir, allow_create)?;
    #[cfg(all(not(debug_assertions), target_os = "macos"))]
    let bytes = load_macos_release_key(data_dir, allow_create)?;
    #[cfg(not(target_os = "macos"))]
    let bytes = {
        let _ = data_dir;
        load_keyring_key(allow_create)?
    };

    install_key(bytes)
}

pub async fn database_requires_existing_key(path: &Path) -> AppResult<bool> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.len() == 0 => return Ok(false),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    }
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let has_settings: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings')",
    )
    .fetch_one(&pool)
    .await?;
    let requires_key = if has_settings {
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM settings WHERE key = ?)")
            .bind(KEY_CHECK_SETTING)
            .fetch_one(&pool)
            .await?
    } else {
        false
    };
    pool.close().await;
    Ok(requires_key)
}

#[cfg(any(not(target_os = "macos"), debug_assertions))]
fn load_keyring_key(allow_create: bool) -> AppResult<Zeroizing<Vec<u8>>> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| {
        AppError::Crypto(format!("cannot access system credential store: {error}"))
    })?;
    match read_keyring_key(&entry)? {
        Some(secret) => Ok(secret),
        None if !allow_create => Err(AppError::Crypto(
            "the database is encrypted but its system credential-store key is missing".into(),
        )),
        None => {
            let bytes = generate_key();
            save_keyring_key(&entry, &bytes)?;
            Ok(bytes)
        }
    }
}

fn read_keyring_key(entry: &keyring::Entry) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
    match entry.get_secret() {
        Ok(secret) => Ok(Some(Zeroizing::new(secret))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(AppError::Crypto(format!(
            "system credential store access was denied or unavailable: {error}"
        ))),
    }
}

fn save_keyring_key(entry: &keyring::Entry, bytes: &[u8]) -> AppResult<()> {
    entry.set_secret(bytes).map_err(|error| {
        AppError::Crypto(format!(
            "cannot save database key in system credential store: {error}"
        ))
    })
}

fn generate_key() -> Zeroizing<Vec<u8>> {
    let mut generated = Zeroizing::new(vec![0u8; KEY_LEN]);
    rand::rng().fill_bytes(&mut generated);
    generated
}

#[cfg(all(not(debug_assertions), target_os = "macos"))]
fn load_macos_release_key(data_dir: &Path, allow_create: bool) -> AppResult<Zeroizing<Vec<u8>>> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|error| {
        AppError::Crypto(format!("cannot access system credential store: {error}"))
    })?;
    match read_keyring_key(&entry)? {
        Some(bytes) => Ok(bytes),
        None => {
            let path = data_dir.join(DEV_KEY_FILE);
            if let Some(bytes) = read_private_key_file(&path)? {
                save_keyring_key(&entry, &bytes)?;
                return Ok(bytes);
            }
            if !allow_create {
                return Err(AppError::Crypto(
                    "the database is encrypted but its system credential-store key is missing"
                        .into(),
                ));
            }
            let bytes = generate_key();
            save_keyring_key(&entry, &bytes)?;
            Ok(bytes)
        }
    }
}

fn install_key(bytes: Zeroizing<Vec<u8>>) -> AppResult<()> {
    if bytes.len() != KEY_LEN {
        return Err(AppError::Crypto(
            "stored database master key has an invalid length".into(),
        ));
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    let _ = MASTER_KEY.set(Zeroizing::new(key));
    Ok(())
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn load_development_key(data_dir: &Path, allow_create: bool) -> AppResult<Zeroizing<Vec<u8>>> {
    let path = data_dir.join(DEV_KEY_FILE);
    if let Some(bytes) = read_private_key_file(&path)? {
        return Ok(bytes);
    }

    // A new development database does not need Keychain access at all. For an
    // existing encrypted database, authorize exactly one Keychain read and
    // cache that same key; denial never falls through to key generation.
    let bytes = if allow_create {
        generate_key()
    } else {
        load_keyring_key(false)?
    };
    write_private_key_file(data_dir, &path, &bytes)?;
    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn read_private_key_file(path: &Path) -> AppResult<Option<Zeroizing<Vec<u8>>>> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::Crypto(
            "development key cache is not a regular file".into(),
        ));
    }
    set_private_file_permissions(path)?;
    let bytes = Zeroizing::new(std::fs::read(path)?);
    if bytes.len() != KEY_LEN {
        return Err(AppError::Crypto(
            "development key cache contains an invalid database key".into(),
        ));
    }
    Ok(Some(bytes))
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn write_private_key_file(data_dir: &Path, path: &Path, bytes: &[u8]) -> AppResult<()> {
    use std::io::Write;

    std::fs::create_dir_all(data_dir)?;
    set_private_dir_permissions(data_dir)?;
    let temp = data_dir.join(format!(".{DEV_KEY_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        match std::fs::hard_link(&temp, path) {
            Ok(()) => {
                std::fs::remove_file(&temp)?;
                set_private_file_permissions(path)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing = read_private_key_file(path)?.ok_or_else(|| {
                    AppError::Crypto("development key cache disappeared during startup".into())
                })?;
                if existing.as_slice() != bytes {
                    return Err(AppError::Crypto(
                        "another Sageport process initialized a different development key".into(),
                    ));
                }
                std::fs::remove_file(&temp)?;
            }
            Err(error) => return Err(error.into()),
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn set_private_dir_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_private_file_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn key() -> AppResult<&'static [u8; KEY_LEN]> {
    #[cfg(test)]
    if MASTER_KEY.get().is_none() {
        let _ = MASTER_KEY.set(Zeroizing::new([0x5au8; KEY_LEN]));
    }
    MASTER_KEY
        .get()
        .map(|value| &**value)
        .ok_or_else(|| AppError::Crypto("database encryption key is not initialized".into()))
}

pub fn is_sealed(value: &str) -> bool {
    value.starts_with(PREFIX)
}

pub fn seal(context: &str, plaintext: &str) -> AppResult<String> {
    if plaintext.is_empty() {
        return Ok(plaintext.to_string());
    }
    let mut nonce = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce);
    let cipher =
        Aes256Gcm::new_from_slice(key()?).map_err(|error| AppError::Crypto(error.to_string()))?;
    let ciphertext = cipher
        .encrypt(
            &Nonce::from(nonce),
            Payload {
                msg: plaintext.as_bytes(),
                aad: context.as_bytes(),
            },
        )
        .map_err(|error| AppError::Crypto(error.to_string()))?;
    let mut encoded = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    encoded.extend_from_slice(&nonce);
    encoded.extend_from_slice(&ciphertext);
    Ok(format!("{PREFIX}{}", STANDARD.encode(encoded)))
}

pub fn open(context: &str, value: &str) -> AppResult<String> {
    let Some(encoded) = value.strip_prefix(PREFIX) else {
        return Ok(value.to_string());
    };
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| AppError::Crypto("stored credential is corrupted".into()))?;
    if bytes.len() < NONCE_LEN + 16 {
        return Err(AppError::Crypto("stored credential is corrupted".into()));
    }
    let (nonce, ciphertext) = bytes.split_at(NONCE_LEN);
    let cipher =
        Aes256Gcm::new_from_slice(key()?).map_err(|error| AppError::Crypto(error.to_string()))?;
    let plaintext = cipher
        .decrypt(
            &Nonce::try_from(nonce)
                .map_err(|_| AppError::Crypto("stored credential is corrupted".into()))?,
            Payload {
                msg: ciphertext,
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| AppError::Crypto("stored credential cannot be decrypted".into()))?;
    String::from_utf8(plaintext)
        .map_err(|_| AppError::Crypto("stored credential is not valid UTF-8".into()))
}

pub fn seal_optional(context: &str, value: Option<&str>) -> AppResult<Option<String>> {
    value
        .filter(|value| !value.is_empty())
        .map(|value| seal(context, value))
        .transpose()
}

pub fn open_optional(context: &str, value: Option<String>) -> AppResult<Option<String>> {
    value.map(|value| open(context, &value)).transpose()
}

pub fn open_host(mut host: Host) -> AppResult<Host> {
    host.password = open_optional(&format!("hosts:{}:password", host.id), host.password)?;
    Ok(host)
}

pub fn open_identity(mut identity: Identity) -> AppResult<Identity> {
    identity.password = open_optional(
        &format!("identities:{}:password", identity.id),
        identity.password,
    )?;
    Ok(identity)
}

pub fn open_key(mut key: SshKey) -> AppResult<SshKey> {
    key.private_key = open_optional(&format!("keys:{}:private_key", key.id), key.private_key)?;
    key.passphrase = open_optional(&format!("keys:{}:passphrase", key.id), key.passphrase)?;
    Ok(key)
}

fn sensitive_setting(key: &str) -> bool {
    matches!(key, "ai.api_key" | "sync.connection")
}

pub fn seal_setting(key: &str, value: &str) -> AppResult<String> {
    if sensitive_setting(key) {
        seal(&format!("settings:{key}"), value)
    } else {
        Ok(value.to_string())
    }
}

pub fn open_setting(key: &str, value: &str) -> AppResult<String> {
    if sensitive_setting(key) {
        open(&format!("settings:{key}"), value)
    } else {
        Ok(value.to_string())
    }
}

/// Encrypts legacy plaintext values in a single transaction. Re-running this
/// migration is safe because sealed values carry a versioned prefix.
pub async fn migrate_plaintext(pool: &SqlitePool) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    if let Some(check) = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(KEY_CHECK_SETTING)
        .fetch_optional(&mut *tx)
        .await?
    {
        let opened = open(&format!("settings:{KEY_CHECK_SETTING}"), &check)?;
        if opened != KEY_CHECK_VALUE {
            return Err(AppError::Crypto(
                "the database master key does not match this database".into(),
            ));
        }
    }
    migrate_column(&mut tx, "hosts", "password").await?;
    migrate_column(&mut tx, "identities", "password").await?;
    migrate_column(&mut tx, "keys", "private_key").await?;
    migrate_column(&mut tx, "keys", "passphrase").await?;
    for setting in ["ai.api_key", "sync.connection"] {
        if let Some(value) =
            sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
                .bind(setting)
                .fetch_optional(&mut *tx)
                .await?
        {
            if is_sealed(&value) {
                continue;
            }
            let sealed = seal_setting(setting, &value)?;
            if sealed != value {
                sqlx::query("UPDATE settings SET value = ? WHERE key = ?")
                    .bind(sealed)
                    .bind(setting)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    let check = seal(&format!("settings:{KEY_CHECK_SETTING}"), KEY_CHECK_VALUE)?;
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO NOTHING",
    )
    .bind(KEY_CHECK_SETTING)
    .bind(check)
    .bind(crate::domain::now())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn migrate_column(
    tx: &mut Transaction<'_, Sqlite>,
    table: &'static str,
    column: &'static str,
) -> AppResult<()> {
    let query =
        format!("SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL AND {column} != ''");
    let rows: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(query))
        .fetch_all(&mut **tx)
        .await?;
    for (id, value) in rows {
        if is_sealed(&value) {
            continue;
        }
        let context = format!("{table}:{id}:{column}");
        let sealed = seal(&context, &value)?;
        let update = format!("UPDATE {table} SET {column} = ? WHERE id = ?");
        sqlx::query(sqlx::AssertSqlSafe(update))
            .bind(sealed)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ciphertext_is_context_bound_and_roundtrips() {
        let ciphertext = seal("hosts:1:password", "hunter2").unwrap();
        assert!(is_sealed(&ciphertext));
        assert_ne!(ciphertext, "hunter2");
        assert_eq!(open("hosts:1:password", &ciphertext).unwrap(), "hunter2");
        assert!(open("hosts:2:password", &ciphertext).is_err());

        let prefix_like_password = format!("{PREFIX}this-is-user-input");
        let sealed = seal("hosts:1:password", &prefix_like_password).unwrap();
        assert_ne!(sealed, prefix_like_password);
        assert_eq!(
            open("hosts:1:password", &sealed).unwrap(),
            prefix_like_password
        );
    }

    #[tokio::test]
    async fn legacy_plaintext_is_migrated_idempotently() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let ts = crate::domain::now();
        sqlx::query(
            "INSERT INTO hosts
             (id, label, address, port, username, auth_type, password, created_at, updated_at)
             VALUES ('legacy', 'Legacy', 'example.com', 22, 'root', 'password', 'plaintext', ?, ?)",
        )
        .bind(&ts)
        .bind(&ts)
        .execute(&pool)
        .await
        .unwrap();

        migrate_plaintext(&pool).await.unwrap();
        let first: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'legacy'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(is_sealed(&first));
        assert_eq!(open("hosts:legacy:password", &first).unwrap(), "plaintext");

        migrate_plaintext(&pool).await.unwrap();
        let second: String = sqlx::query_scalar("SELECT password FROM hosts WHERE id = 'legacy'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(first, second);
    }

    #[tokio::test]
    async fn detects_when_an_existing_database_requires_its_original_key() {
        let dir = std::env::temp_dir().join(format!("sageport-key-check-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("sageport.db");
        assert!(!database_requires_existing_key(&path).await.unwrap());

        let pool = crate::db::init(&path).await.unwrap();
        assert!(!database_requires_existing_key(&path).await.unwrap());
        sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, 'check', ?)")
            .bind(KEY_CHECK_SETTING)
            .bind(crate::domain::now())
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        assert!(database_requires_existing_key(&path).await.unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[cfg(all(debug_assertions, target_os = "macos"))]
    fn development_key_cache_is_private_and_never_overwritten() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("sageport-dev-key-{}", uuid::Uuid::new_v4()));
        let path = dir.join(DEV_KEY_FILE);
        let key = [0xabu8; KEY_LEN];
        write_private_key_file(&dir, &path, &key).unwrap();

        assert_eq!(
            read_private_key_file(&path).unwrap().unwrap().as_slice(),
            key
        );
        assert_eq!(
            std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        write_private_key_file(&dir, &path, &key).unwrap();
        assert!(write_private_key_file(&dir, &path, &[0xcdu8; KEY_LEN]).is_err());
        assert_eq!(
            read_private_key_file(&path).unwrap().unwrap().as_slice(),
            key
        );

        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[cfg(all(debug_assertions, target_os = "macos"))]
    fn development_key_cache_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = std::env::temp_dir().join(format!("sageport-dev-link-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let target = dir.join("target");
        std::fs::write(&target, [0u8; KEY_LEN]).unwrap();
        let link = dir.join(DEV_KEY_FILE);
        symlink(&target, &link).unwrap();

        assert!(read_private_key_file(&link).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
