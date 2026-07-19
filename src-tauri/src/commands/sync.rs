use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

use crate::crypto::EncryptedEnvelope;
use crate::domain::now;
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::{self, oauth, ProviderConfig, ProviderKind, SyncVersion};

use super::forwards;

const CONNECTION_KEY: &str = "sync.connection";
const MAX_CONNECTION_BYTES: usize = 256 * 1024;
const MAX_PASSPHRASE_BYTES: usize = 4096;
const MAX_URL_BYTES: usize = 8192;
const MAX_CREDENTIAL_BYTES: usize = 16 * 1024;
const MAX_LABEL_BYTES: usize = 1024;
const MAX_PREFIX_BYTES: usize = 4096;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_VERSION_ID_BYTES: usize = 4096;

#[derive(Serialize, Deserialize)]
struct Connection {
    config: ProviderConfig,

    account: String,

    passphrase: String,
    last_synced_at: Option<String>,

    pending_restore: bool,

    #[serde(default)]
    seen_version_ids: Vec<String>,

    #[serde(default)]
    seen_versions_initialized: bool,
}

async fn load_connection(state: &AppState) -> AppResult<Option<Connection>> {
    let Some(raw) = settings_repo::get(&state.db, CONNECTION_KEY)
        .await?
        .filter(|v| !v.is_empty())
    else {
        return Ok(None);
    };
    if raw.len() > MAX_CONNECTION_BYTES {
        return Err(AppError::Invalid(
            "saved sync connection exceeds supported limits".into(),
        ));
    }
    Ok(Some(serde_json::from_str(&raw)?))
}

async fn require_connection(state: &AppState) -> AppResult<Connection> {
    load_connection(state)
        .await?
        .ok_or_else(|| AppError::Invalid("sync is not connected".into()))
}

async fn save_connection(state: &AppState, conn: &Connection) -> AppResult<()> {
    settings_repo::set(&state.db, CONNECTION_KEY, &serde_json::to_string(conn)?).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub provider: Option<ProviderKind>,

    pub account: Option<String>,

    pub detail: Option<String>,
    pub last_synced_at: Option<String>,
    pub auto_sync_in_progress: bool,
    pub auto_sync_error: Option<String>,

    pub oauth_ready: OAuthReady,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthReady {
    pub gist: bool,
    pub gdrive: bool,
    pub onedrive: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConnectOutcome {
    Connected,

    PassphraseMismatch,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PushOutcome {
    Pushed,
    Unchanged,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub remote_synced: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthAccount {
    pub account: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebdavSettings {
    url: String,
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct S3Settings {
    endpoint: String,
    #[serde(default)]
    region: String,
    bucket: String,
    #[serde(default)]
    prefix: String,
    access_key: String,
    secret_key: String,
    #[serde(default)]
    path_style: bool,
}

#[tauri::command]
pub async fn sync_get_status(state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let conn = load_connection(&state).await?;
    let runtime = state.sync_runtime.lock();
    Ok(SyncStatus {
        provider: conn.as_ref().map(|c| c.config.kind()),
        detail: conn.as_ref().and_then(|c| c.config.detail()),
        account: conn.as_ref().map(|c| c.account.clone()),
        last_synced_at: conn.and_then(|c| c.last_synced_at),
        auto_sync_in_progress: runtime.active_operations > 0,
        auto_sync_error: runtime.last_error.clone(),
        oauth_ready: OAuthReady {
            gist: oauth::GITHUB_CLIENT_ID.is_some_and(|v| !v.is_empty()),
            gdrive: oauth::GOOGLE_CLIENT_ID.is_some_and(|v| !v.is_empty())
                && oauth::GOOGLE_CLIENT_SECRET.is_some_and(|v| !v.is_empty()),
            onedrive: oauth::MS_CLIENT_ID.is_some_and(|v| !v.is_empty()),
        },
    })
}

#[tauri::command]
pub async fn sync_oauth_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
    on_event: tauri::ipc::Channel<oauth::OAuthEvent>,
) -> AppResult<OAuthAccount> {
    let kind = ProviderKind::parse(&provider)?;
    if matches!(kind, ProviderKind::Webdav | ProviderKind::S3) {
        return Err(AppError::Invalid("this provider does not use OAuth".into()));
    }

    let (cancel_tx, cancel_rx) = oneshot::channel();
    let generation = {
        let mut slot = state.sync_oauth.lock();
        slot.generation = slot.generation.wrapping_add(1);
        if let Some(prev) = slot.cancel.take() {
            let _ = prev.send(());
        }
        slot.pending = None;
        slot.cancel = Some(cancel_tx);
        slot.generation
    };

    let result = match kind {
        ProviderKind::Gist => oauth::github_device_flow(&on_event, cancel_rx).await,
        ProviderKind::Gdrive => oauth::google_flow(&app, &on_event, cancel_rx).await,
        ProviderKind::Onedrive => oauth::microsoft_flow(&app, &on_event, cancel_rx).await,
        ProviderKind::Webdav | ProviderKind::S3 => unreachable!("checked above"),
    };

    let mut slot = state.sync_oauth.lock();
    if slot.generation != generation {
        return Err(AppError::Cancelled);
    }
    slot.cancel = None;
    match result {
        Err(err) => Err(err),
        Ok(outcome) => {
            let account = outcome.account.clone();
            slot.pending = Some((kind, outcome));
            Ok(OAuthAccount { account })
        }
    }
}

#[tauri::command]
pub async fn sync_oauth_cancel(state: State<'_, AppState>) -> AppResult<()> {
    let mut slot = state.sync_oauth.lock();
    slot.generation = slot.generation.wrapping_add(1);
    slot.pending = None;
    if let Some(cancel) = slot.cancel.take() {
        let _ = cancel.send(());
    }
    Ok(())
}

fn build_config(
    state: &AppState,
    kind: ProviderKind,
    settings: Option<serde_json::Value>,
) -> AppResult<(ProviderConfig, String, Option<u64>)> {
    match kind {
        ProviderKind::Gist | ProviderKind::Gdrive | ProviderKind::Onedrive => {
            let slot = state.sync_oauth.lock();
            let Some((pending_kind, outcome)) = slot.pending.as_ref() else {
                return Err(AppError::Invalid(
                    "authorize with the provider first".into(),
                ));
            };
            if *pending_kind != kind {
                return Err(AppError::Invalid(
                    "authorize with the provider first".into(),
                ));
            }
            let config = match (&outcome.credential, kind) {
                (oauth::OAuthCredential::GithubToken(token), ProviderKind::Gist) => {
                    ProviderConfig::Gist {
                        token: token.clone(),
                        gist_id: None,
                    }
                }
                (oauth::OAuthCredential::Tokens(tokens), ProviderKind::Gdrive) => {
                    ProviderConfig::Gdrive {
                        tokens: tokens.clone(),
                    }
                }
                (oauth::OAuthCredential::Tokens(tokens), ProviderKind::Onedrive) => {
                    ProviderConfig::Onedrive {
                        tokens: tokens.clone(),
                    }
                }
                _ => {
                    return Err(AppError::Invalid(
                        "authorize with the provider first".into(),
                    ))
                }
            };
            Ok((config, outcome.account.clone(), Some(slot.generation)))
        }
        ProviderKind::Webdav => {
            let s: WebdavSettings = parse_settings(settings)?;
            let url = bounded_trimmed(&s.url, MAX_URL_BYTES, "server URL")?;
            let username = bounded(&s.username, MAX_LABEL_BYTES, "username")?.to_string();
            let password = bounded(&s.password, MAX_CREDENTIAL_BYTES, "password")?.to_string();
            let account = username.clone();
            Ok((
                ProviderConfig::Webdav {
                    url,
                    username,
                    password,
                },
                account,
                None,
            ))
        }
        ProviderKind::S3 => {
            let s: S3Settings = parse_settings(settings)?;
            let endpoint = bounded_trimmed(&s.endpoint, MAX_URL_BYTES, "endpoint")?;
            let bucket = bounded_trimmed(&s.bucket, MAX_LABEL_BYTES, "bucket")?;
            let access_key = bounded_trimmed(&s.access_key, MAX_CREDENTIAL_BYTES, "access key")?;
            let secret_key =
                bounded(&s.secret_key, MAX_CREDENTIAL_BYTES, "secret key")?.to_string();
            if secret_key.is_empty() {
                return Err(AppError::Invalid("secret key is required".into()));
            }
            let region = match bounded(&s.region, MAX_LABEL_BYTES, "region")?.trim() {
                "" => "us-east-1".to_string(),
                r => r.to_string(),
            };
            let prefix = bounded(&s.prefix, MAX_PREFIX_BYTES, "prefix")?
                .trim()
                .to_string();
            let account = bucket.clone();
            Ok((
                ProviderConfig::S3 {
                    endpoint,
                    region,
                    bucket,
                    prefix,
                    access_key,
                    secret_key,
                    path_style: s.path_style,
                },
                account,
                None,
            ))
        }
    }
}

fn parse_settings<T: serde::de::DeserializeOwned>(
    settings: Option<serde_json::Value>,
) -> AppResult<T> {
    let value =
        settings.ok_or_else(|| AppError::Invalid("provider settings are required".into()))?;
    serde_json::from_value(value)
        .map_err(|e| AppError::Invalid(format!("invalid provider settings: {e}")))
}

#[tauri::command]
pub async fn sync_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: String,
    settings: Option<serde_json::Value>,
    passphrase: String,
    force: bool,
) -> AppResult<ConnectOutcome> {
    validate_passphrase(&passphrase)?;
    let _operation = state.sync_operation.lock().await;
    if load_connection(&state).await?.is_some() {
        return Err(AppError::Invalid(
            "sync is already connected — disconnect first to switch providers".into(),
        ));
    }
    let kind = ProviderKind::parse(&provider)?;
    let (config, account, oauth_generation) = build_config(&state, kind, settings)?;
    let mut backend = sync::make_provider(config)?;

    let mut last_synced_at = None;
    let versions = backend.list_versions().await?;
    if !versions.is_empty() && force {
        backend.clear().await?;
    } else if let Some(latest) = versions.first() {
        let envelope = backend.pull_version(&latest.id).await?;
        match sync::decrypt_snapshot(&envelope, &passphrase).await {
            Ok(snapshot) => {
                import_snapshot(&app, &state, &snapshot).await?;
                last_synced_at = Some(now());
            }
            Err(AppError::Crypto(_)) => return Ok(ConnectOutcome::PassphraseMismatch),
            Err(error) => return Err(error),
        }
    }
    let seen_version_ids = versions.into_iter().map(|version| version.id).collect();

    save_connection(
        &state,
        &Connection {
            config: backend.config(),
            account,
            passphrase,
            last_synced_at,
            pending_restore: false,
            seen_version_ids,
            seen_versions_initialized: true,
        },
    )
    .await?;
    if let Some(generation) = oauth_generation {
        let mut slot = state.sync_oauth.lock();
        if slot.generation == generation {
            slot.pending = None;
        }
    }

    Ok(ConnectOutcome::Connected)
}

#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    let _operation = state.sync_operation.lock().await;
    settings_repo::set(&state.db, CONNECTION_KEY, "").await?;
    let mut slot = state.sync_oauth.lock();
    slot.generation = slot.generation.wrapping_add(1);
    slot.pending = None;
    if let Some(cancel) = slot.cancel.take() {
        let _ = cancel.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_push(app: AppHandle, state: State<'_, AppState>) -> AppResult<PushOutcome> {
    run_sync(&app, &state).await
}

async fn run_sync(app: &AppHandle, state: &AppState) -> AppResult<PushOutcome> {
    {
        let mut runtime = state.sync_runtime.lock();
        runtime.active_operations = runtime.active_operations.saturating_add(1);
    }
    let result = sync_push_inner(app, state).await;
    {
        let mut runtime = state.sync_runtime.lock();
        runtime.active_operations = runtime.active_operations.saturating_sub(1);
        runtime.last_error = result.as_ref().err().map(ToString::to_string);
    }
    result
}

async fn sync_push_inner(app: &AppHandle, state: &AppState) -> AppResult<PushOutcome> {
    let _operation = state.sync_operation.lock().await;
    let mut conn = require_connection(state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;

    let versions = match backend.list_versions().await {
        Ok(value) => value,
        Err(error) => {
            save_refreshed_config(state, &mut conn, backend.config()).await;
            return Err(error);
        }
    };
    let mut remote = None;
    if let Some(latest) = versions.first() {
        let envelope = match backend.pull_version(&latest.id).await {
            Ok(value) => value,
            Err(error) => {
                save_refreshed_config(state, &mut conn, backend.config()).await;
                return Err(error);
            }
        };
        let snapshot = match sync::decrypt_snapshot(&envelope, &conn.passphrase).await {
            Ok(value) => value,
            Err(error) => {
                save_refreshed_config(state, &mut conn, backend.config()).await;
                return Err(error);
            }
        };
        if !conn.pending_restore {
            import_snapshot(app, state, &snapshot).await?;
        }
        remote = Some(snapshot);
    }

    if !conn.pending_restore && conn.seen_versions_initialized {
        for version in versions.iter().skip(1) {
            if conn.seen_version_ids.contains(&version.id) {
                continue;
            }
            let envelope = match backend.pull_version(&version.id).await {
                Ok(value) => value,
                Err(error) => {
                    save_refreshed_config(state, &mut conn, backend.config()).await;
                    return Err(error);
                }
            };
            match sync::decrypt_snapshot(&envelope, &conn.passphrase).await {
                Ok(snapshot) => import_snapshot(app, state, &snapshot).await?,
                Err(error) if is_ignorable_historical_error(&error) => continue,
                Err(error) => {
                    save_refreshed_config(state, &mut conn, backend.config()).await;
                    return Err(error);
                }
            }
        }
    }

    let local = sync::export_snapshot(&state.db).await?;
    let unchanged = remote
        .as_ref()
        .is_some_and(|r| r.content_fingerprint() == local.content_fingerprint());
    if !unchanged {
        let sealed = sync::encrypt_snapshot(&local, &conn.passphrase).await?;
        if let Err(error) = backend.push(&sealed).await {
            save_refreshed_config(state, &mut conn, backend.config()).await;
            return Err(error);
        }
    }

    conn.config = backend.config();
    conn.pending_restore = false;
    conn.seen_version_ids = versions.into_iter().map(|version| version.id).collect();
    conn.seen_versions_initialized = true;
    conn.last_synced_at = Some(now());
    save_connection(state, &conn).await?;

    Ok(if unchanged {
        PushOutcome::Unchanged
    } else {
        PushOutcome::Pushed
    })
}

pub fn run_periodic(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut retry = std::time::Duration::from_secs(30);
        tokio::time::sleep(retry).await;
        loop {
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            let connected = load_connection(&state).await.ok().flatten().is_some();
            if connected {
                match run_sync(&app, &state).await {
                    Ok(_) => retry = std::time::Duration::from_secs(120),
                    Err(_) => {
                        retry = (retry * 2).min(std::time::Duration::from_secs(900));
                    }
                }
            } else {
                retry = std::time::Duration::from_secs(120);
            }
            tokio::time::sleep(retry).await;
        }
    });
}

#[tauri::command]
pub async fn sync_list_versions(state: State<'_, AppState>) -> AppResult<Vec<SyncVersion>> {
    let _operation = state.sync_operation.lock().await;
    let mut conn = require_connection(&state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;
    let versions = match backend.list_versions().await {
        Ok(value) => value,
        Err(error) => {
            save_refreshed_config(&state, &mut conn, backend.config()).await;
            return Err(error);
        }
    };
    conn.config = backend.config();
    save_connection(&state, &conn).await?;
    Ok(versions)
}

#[tauri::command]
pub async fn sync_restore_version(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<RestoreOutcome> {
    validate_version_id(&id)?;
    let _operation = state.sync_operation.lock().await;
    let mut conn = require_connection(&state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;

    let versions = match backend.list_versions().await {
        Ok(value) => value,
        Err(error) => {
            save_refreshed_config(&state, &mut conn, backend.config()).await;
            return Err(error);
        }
    };
    let Some(position) = versions.iter().position(|version| version.id == id) else {
        return Err(AppError::NotFound(
            "sync version is no longer available".into(),
        ));
    };
    let target_is_latest = position == 0;

    let envelope = match backend.pull_version(&id).await {
        Ok(value) => value,
        Err(error) => {
            save_refreshed_config(&state, &mut conn, backend.config()).await;
            return Err(error);
        }
    };
    if let Err(error) = restore_encrypted(&app, &state, &envelope, &conn.passphrase).await {
        save_refreshed_config(&state, &mut conn, backend.config()).await;
        return Err(error);
    }

    conn.config = backend.config();
    conn.pending_restore = !target_is_latest;
    conn.seen_version_ids = versions.into_iter().map(|version| version.id).collect();
    conn.seen_versions_initialized = true;
    conn.last_synced_at = Some(now());
    save_connection(&state, &conn).await?;

    Ok(RestoreOutcome {
        remote_synced: target_is_latest,
    })
}

#[tauri::command]
pub async fn sync_file_export(
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
) -> AppResult<()> {
    validate_passphrase(&passphrase)?;
    validate_path(&path)?;
    let _operation = state.sync_operation.lock().await;
    let envelope = sync::export_encrypted(&state.db, &passphrase).await?;
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || sync::write_envelope_file(&path, &envelope))
        .await
        .map_err(|e| AppError::Other(format!("backup file write task failed: {e}")))?
}

#[tauri::command]
pub async fn sync_file_import(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
) -> AppResult<()> {
    validate_passphrase(&passphrase)?;
    validate_path(&path)?;
    let _operation = state.sync_operation.lock().await;
    let path = PathBuf::from(path);
    let envelope = tokio::task::spawn_blocking(move || sync::read_envelope_file(&path))
        .await
        .map_err(|e| AppError::Other(format!("backup file read task failed: {e}")))??;
    let previous = state.forwards.active_specs();
    sync::import_encrypted(&state.db, &envelope, &passphrase).await?;
    forwards::reconcile_running_forwards(&app, previous);
    Ok(())
}

async fn import_snapshot(
    app: &AppHandle,
    state: &AppState,
    snapshot: &sync::VaultSnapshot,
) -> AppResult<()> {
    let previous = state.forwards.active_specs();
    sync::import_snapshot(&state.db, snapshot).await?;
    forwards::reconcile_running_forwards(app, previous);
    Ok(())
}

async fn restore_encrypted(
    app: &AppHandle,
    state: &AppState,
    envelope: &EncryptedEnvelope,
    passphrase: &str,
) -> AppResult<()> {
    let previous = state.forwards.active_specs();
    sync::restore_encrypted(&state.db, envelope, passphrase).await?;
    forwards::reconcile_running_forwards(app, previous);
    Ok(())
}

async fn save_refreshed_config(state: &AppState, conn: &mut Connection, config: ProviderConfig) {
    conn.config = config;
    let _ = save_connection(state, conn).await;
}

fn validate_passphrase(passphrase: &str) -> AppResult<()> {
    if passphrase.is_empty() {
        return Err(AppError::Invalid("passphrase is required".into()));
    }
    if passphrase.len() > MAX_PASSPHRASE_BYTES {
        return Err(AppError::Invalid("passphrase is too long".into()));
    }
    Ok(())
}

fn is_ignorable_historical_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Crypto(_) | AppError::Serde(_) | AppError::Invalid(_)
    )
}

fn validate_path(path: &str) -> AppResult<()> {
    if path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0') {
        return Err(AppError::Invalid("invalid backup file path".into()));
    }
    Ok(())
}

fn validate_version_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.len() > MAX_VERSION_ID_BYTES || id.chars().any(char::is_control) {
        return Err(AppError::Invalid("invalid sync version id".into()));
    }
    Ok(())
}

fn bounded<'a>(value: &'a str, max: usize, label: &str) -> AppResult<&'a str> {
    if value.len() > max || value.chars().any(char::is_control) {
        return Err(AppError::Invalid(format!("invalid or oversized {label}")));
    }
    Ok(value)
}

fn bounded_trimmed(value: &str, max: usize, label: &str) -> AppResult<String> {
    let value = bounded(value, max, label)?.trim();
    if value.is_empty() {
        return Err(AppError::Invalid(format!("{label} is required")));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_boundaries_reject_oversized_or_unsafe_sync_inputs() {
        assert!(validate_passphrase("").is_err());
        assert!(validate_passphrase(&"x".repeat(MAX_PASSPHRASE_BYTES + 1)).is_err());
        assert!(validate_path("").is_err());
        assert!(validate_path("vault\0.json").is_err());
        assert!(validate_version_id("version\nheader").is_err());
        assert!(bounded("line\nbreak", 100, "value").is_err());
        assert_eq!(
            bounded_trimmed("  bucket  ", 100, "bucket").unwrap(),
            "bucket"
        );
    }

    #[test]
    fn old_connection_records_migrate_without_replaying_history() {
        let json = serde_json::json!({
            "config": {
                "kind": "webdav",
                "url": "https://example.com/vault",
                "username": "user",
                "password": "secret"
            },
            "account": "user",
            "passphrase": "vault-passphrase",
            "last_synced_at": "2026-07-15T00:00:00+00:00",
            "pending_restore": false
        });
        let connection: Connection = serde_json::from_value(json).unwrap();
        assert!(connection.seen_version_ids.is_empty());
        assert!(!connection.seen_versions_initialized);
    }
}
