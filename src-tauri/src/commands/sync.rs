//! Sync commands.
//!
//! Exactly one remote provider (GitHub Gist, Google Drive, OneDrive, WebDAV
//! or S3-compatible storage) is connected at a time; switching providers
//! means `sync_disconnect` followed by a fresh `sync_connect`. All providers
//! store the same passphrase-sealed vault and share one command surface:
//!
//! * `sync_oauth_start` / `sync_oauth_cancel` — browser-based authorization
//!   for the OAuth providers (GitHub device flow; Google/Microsoft loopback
//!   with PKCE). A completed flow parks its credential in [`AppState`] so
//!   the token never crosses into the webview; `sync_connect` claims it.
//! * `sync_connect` — link a provider. If the target already holds a backup
//!   it is pulled and decrypted first: success merges it in
//!   (last-write-wins), a decrypt failure returns
//!   [`ConnectOutcome::PassphraseMismatch`] so the UI can re-prompt or
//!   force-overwrite (`force: true` wipes the remote history and starts
//!   over — old revisions sealed with an abandoned passphrase would
//!   otherwise linger in the version list).
//! * `sync_push` — pull-merge-push so a device that hasn't seen another
//!   device's edits can't clobber them. The final push is skipped when the
//!   merge left the vault content-identical to what the remote already
//!   holds (see [`sync::VaultSnapshot::content_fingerprint`]), so reconnects
//!   and no-op syncs don't spend a slot in the provider's version history.
//! * `sync_list_versions` / `sync_restore_version` — browse backup history
//!   and roll back. Restoring replaces local data outright (not a merge);
//!   the frontend confirms before calling.
//!
//! Local file backup (`sync_file_export` / `sync_file_import`) is a separate
//! one-shot feature, independent of the connected provider: the passphrase
//! is supplied per call and never persisted.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;
use tokio::sync::oneshot;

use crate::crypto;
use crate::domain::now;
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::{self, oauth, ProviderConfig, ProviderKind, SyncVersion};

const PROVIDER_KEY: &str = "sync.provider";
const CONFIG_KEY: &str = "sync.provider_config";
const ACCOUNT_KEY: &str = "sync.account";
const PASSPHRASE_KEY: &str = "sync.passphrase";
const LAST_SYNCED_KEY: &str = "sync.last_synced_at";

/// Non-secret view of the sync state handed to the UI.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// Connected provider, `None` when sync is not set up.
    pub provider: Option<ProviderKind>,
    /// Human-readable account label (GitHub login, e-mail, username, ...).
    pub account: Option<String>,
    /// Non-secret location detail (gist id, bucket, server URL).
    pub detail: Option<String>,
    pub last_synced_at: Option<String>,
    /// Which OAuth providers this build carries client ids for; the UI
    /// disables the others with a setup hint.
    pub oauth_ready: OAuthReady,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthReady {
    pub gist: bool,
    pub gdrive: bool,
    pub onedrive: bool,
}

/// Outcome of `sync_connect`, tagged so the frontend can branch without
/// treating a passphrase mismatch as a hard error.
#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConnectOutcome {
    Connected,
    /// A backup exists but the passphrase can't decrypt it. Nothing was
    /// persisted — retry with another passphrase, or `force: true` to
    /// overwrite the remote.
    PassphraseMismatch,
}

/// Resolved account label returned by a completed OAuth flow.
#[derive(serde::Serialize)]
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

async fn stored_config(state: &AppState) -> AppResult<Option<ProviderConfig>> {
    let Some(raw) = settings_repo::get(&state.db, CONFIG_KEY)
        .await?
        .filter(|v| !v.is_empty())
    else {
        return Ok(None);
    };
    Ok(Some(serde_json::from_str(&raw)?))
}

async fn require_config(state: &AppState) -> AppResult<ProviderConfig> {
    stored_config(state)
        .await?
        .ok_or_else(|| AppError::Invalid("sync is not connected".into()))
}

async fn require_passphrase(state: &AppState) -> AppResult<String> {
    settings_repo::get(&state.db, PASSPHRASE_KEY)
        .await?
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Invalid("no vault passphrase configured for sync".into()))
}

/// Persist the provider's (possibly mutated) config — refreshed OAuth
/// tokens, discovered gist ids — after any provider operation.
async fn persist_config(state: &AppState, config: &ProviderConfig) -> AppResult<()> {
    settings_repo::set(&state.db, CONFIG_KEY, &serde_json::to_string(config)?).await
}

async fn mark_synced(state: &AppState) -> AppResult<()> {
    settings_repo::set(&state.db, LAST_SYNCED_KEY, &now()).await
}

#[tauri::command]
pub async fn sync_get_status(state: State<'_, AppState>) -> AppResult<SyncStatus> {
    let config = stored_config(&state).await?;
    let account = settings_repo::get(&state.db, ACCOUNT_KEY)
        .await?
        .filter(|v| !v.is_empty());
    let last_synced_at = settings_repo::get(&state.db, LAST_SYNCED_KEY)
        .await?
        .filter(|v| !v.is_empty());
    Ok(SyncStatus {
        provider: config.as_ref().map(|c| c.kind()),
        detail: config.as_ref().and_then(|c| c.detail()),
        account,
        last_synced_at,
        oauth_ready: OAuthReady {
            gist: oauth::GITHUB_CLIENT_ID.is_some_and(|v| !v.is_empty()),
            gdrive: oauth::GOOGLE_CLIENT_ID.is_some_and(|v| !v.is_empty())
                && oauth::GOOGLE_CLIENT_SECRET.is_some_and(|v| !v.is_empty()),
            onedrive: oauth::MS_CLIENT_ID.is_some_and(|v| !v.is_empty()),
        },
    })
}

/// Run the OAuth flow for `provider`, streaming progress (device code /
/// browser opened) through `on_event`. The resulting credential is parked in
/// [`AppState`] — never returned to the webview — for the follow-up
/// `sync_connect` to claim; only the account label goes back to the UI.
#[tauri::command]
pub async fn sync_oauth_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
    on_event: tauri::ipc::Channel<oauth::OAuthEvent>,
) -> AppResult<OAuthAccount> {
    let kind = ProviderKind::parse(&provider)?;

    let (cancel_tx, cancel_rx) = oneshot::channel();
    {
        let mut slot = state.sync_oauth.lock();
        // A restarted flow supersedes (and aborts) the previous one.
        if let Some(prev) = slot.cancel.take() {
            let _ = prev.send(());
        }
        slot.cancel = Some(cancel_tx);
    }

    let result = match kind {
        ProviderKind::Gist => oauth::github_device_flow(&on_event, cancel_rx).await,
        ProviderKind::Gdrive => oauth::google_flow(&app, &on_event, cancel_rx).await,
        ProviderKind::Onedrive => oauth::microsoft_flow(&app, &on_event, cancel_rx).await,
        ProviderKind::Webdav | ProviderKind::S3 => {
            Err(AppError::Invalid("this provider does not use OAuth".into()))
        }
    };

    match result {
        // Superseded by a newer flow — leave its cancel slot alone.
        Err(AppError::Cancelled) => Err(AppError::Cancelled),
        Err(err) => {
            state.sync_oauth.lock().cancel = None;
            Err(err)
        }
        Ok(outcome) => {
            let account = outcome.account.clone();
            let mut slot = state.sync_oauth.lock();
            slot.cancel = None;
            slot.pending = Some((kind, outcome));
            Ok(OAuthAccount { account })
        }
    }
}

#[tauri::command]
pub async fn sync_oauth_cancel(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(cancel) = state.sync_oauth.lock().cancel.take() {
        let _ = cancel.send(());
    }
    Ok(())
}

/// Build the provider config for a connect attempt: OAuth kinds claim the
/// parked credential (peeked, not consumed — a passphrase mismatch must not
/// force the user back through the browser), credential kinds parse the
/// user-supplied `settings`. Returns the config plus the account label.
fn build_config(
    state: &AppState,
    kind: ProviderKind,
    settings: Option<serde_json::Value>,
) -> AppResult<(ProviderConfig, String)> {
    match kind {
        ProviderKind::Gist | ProviderKind::Gdrive | ProviderKind::Onedrive => {
            let slot = state.sync_oauth.lock();
            let Some((pending_kind, outcome)) = slot.pending.as_ref() else {
                return Err(AppError::Invalid("authorize with the provider first".into()));
            };
            if *pending_kind != kind {
                return Err(AppError::Invalid("authorize with the provider first".into()));
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
                _ => return Err(AppError::Invalid("authorize with the provider first".into())),
            };
            Ok((config, outcome.account.clone()))
        }
        ProviderKind::Webdav => {
            let s: WebdavSettings = parse_settings(settings)?;
            if s.url.trim().is_empty() {
                return Err(AppError::Invalid("server URL is required".into()));
            }
            let account = s.username.clone();
            Ok((
                ProviderConfig::Webdav {
                    url: s.url.trim().to_string(),
                    username: s.username,
                    password: s.password,
                },
                account,
            ))
        }
        ProviderKind::S3 => {
            let s: S3Settings = parse_settings(settings)?;
            for (value, label) in [
                (&s.endpoint, "endpoint"),
                (&s.bucket, "bucket"),
                (&s.access_key, "access key"),
                (&s.secret_key, "secret key"),
            ] {
                if value.trim().is_empty() {
                    return Err(AppError::Invalid(format!("{label} is required")));
                }
            }
            let region = match s.region.trim() {
                "" => "us-east-1".to_string(),
                r => r.to_string(),
            };
            let account = s.bucket.clone();
            Ok((
                ProviderConfig::S3 {
                    endpoint: s.endpoint.trim().to_string(),
                    region,
                    bucket: s.bucket.trim().to_string(),
                    prefix: s.prefix.trim().to_string(),
                    access_key: s.access_key.trim().to_string(),
                    secret_key: s.secret_key,
                    path_style: s.path_style,
                },
                account,
            ))
        }
    }
}

fn parse_settings<T: serde::de::DeserializeOwned>(
    settings: Option<serde_json::Value>,
) -> AppResult<T> {
    let value = settings.ok_or_else(|| AppError::Invalid("provider settings are required".into()))?;
    serde_json::from_value(value)
        .map_err(|e| AppError::Invalid(format!("invalid provider settings: {e}")))
}

#[tauri::command]
pub async fn sync_connect(
    state: State<'_, AppState>,
    provider: String,
    settings: Option<serde_json::Value>,
    passphrase: String,
    force: bool,
) -> AppResult<ConnectOutcome> {
    if passphrase.is_empty() {
        return Err(AppError::Invalid("passphrase is required".into()));
    }
    if stored_config(&state).await?.is_some() {
        return Err(AppError::Invalid(
            "sync is already connected — disconnect first to switch providers".into(),
        ));
    }
    let kind = ProviderKind::parse(&provider)?;
    let (config, account) = build_config(&state, kind, settings)?;
    let mut backend = sync::make_provider(config)?;

    // Probe the target before persisting anything: an existing backup is
    // merged in (or reported as a mismatch); only then does the connection
    // become real.
    let remote = backend.pull_latest().await?;
    let mut remote_fingerprint = None;
    match remote {
        Some(envelope) if !force => match crypto::decrypt(&envelope, &passphrase) {
            Ok(bytes) => {
                let snapshot: sync::VaultSnapshot = serde_json::from_slice(&bytes)?;
                remote_fingerprint = Some(snapshot.content_fingerprint());
                sync::import_snapshot(&state.db, &snapshot).await?;
            }
            Err(AppError::Crypto(_)) => return Ok(ConnectOutcome::PassphraseMismatch),
            Err(err) => return Err(err),
        },
        _ => {}
    }

    // Seal the (merged) local vault and make it the newest backup — but only
    // when connecting actually changes what the remote holds. A bare
    // reconnect to a target that already matches local data would otherwise
    // stamp out a new, content-identical backup revision every time,
    // needlessly burning through the provider's version history.
    let snapshot = sync::export_snapshot(&state.db).await?;
    if force || remote_fingerprint.as_ref() != Some(&snapshot.content_fingerprint()) {
        let sealed = crypto::encrypt(&serde_json::to_vec(&snapshot)?, &passphrase)?;
        if force {
            backend.reset(&sealed).await?;
        } else {
            backend.push(&sealed).await?;
        }
    }

    settings_repo::set(&state.db, PROVIDER_KEY, &provider).await?;
    persist_config(&state, &backend.config()).await?;
    settings_repo::set(&state.db, ACCOUNT_KEY, &account).await?;
    settings_repo::set(&state.db, PASSPHRASE_KEY, &passphrase).await?;
    mark_synced(&state).await?;
    state.sync_oauth.lock().pending = None;

    Ok(ConnectOutcome::Connected)
}

/// Forget the provider connection and credentials. Remote backups are left
/// untouched.
#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    for key in [
        PROVIDER_KEY,
        CONFIG_KEY,
        ACCOUNT_KEY,
        PASSPHRASE_KEY,
        LAST_SYNCED_KEY,
    ] {
        settings_repo::set(&state.db, key, "").await?;
    }
    state.sync_oauth.lock().pending = None;
    Ok(())
}

/// Merge the remote backup into the local vault (so edits from other devices
/// survive), then push the result as a new backup revision.
#[tauri::command]
pub async fn sync_push(state: State<'_, AppState>) -> AppResult<()> {
    let config = require_config(&state).await?;
    let passphrase = require_passphrase(&state).await?;
    let mut backend = sync::make_provider(config)?;

    let mut remote_fingerprint = None;
    if let Some(envelope) = backend.pull_latest().await? {
        // Left as `AppError::Crypto` (code "crypto") rather than rewrapped with
        // an English explanation here — the frontend maps the code to a
        // localized, context-appropriate message instead.
        let snapshot = sync::import_encrypted(&state.db, &envelope, &passphrase).await?;
        remote_fingerprint = Some(snapshot.content_fingerprint());
    }

    // Skip pushing when the merged local vault already matches the remote —
    // an unconditional push here would otherwise add a content-identical
    // backup revision every time the user hits "sync now" with nothing new
    // to contribute, crowding out the provider's limited version history.
    let snapshot = sync::export_snapshot(&state.db).await?;
    if remote_fingerprint.as_ref() != Some(&snapshot.content_fingerprint()) {
        let sealed = crypto::encrypt(&serde_json::to_vec(&snapshot)?, &passphrase)?;
        backend.push(&sealed).await?;
    }

    persist_config(&state, &backend.config()).await?;
    mark_synced(&state).await
}

/// Backup history of the connected provider, newest first.
#[tauri::command]
pub async fn sync_list_versions(state: State<'_, AppState>) -> AppResult<Vec<SyncVersion>> {
    let config = require_config(&state).await?;
    let mut backend = sync::make_provider(config)?;
    let versions = backend.list_versions().await?;
    persist_config(&state, &backend.config()).await?;
    Ok(versions)
}

/// Roll the local vault back to one specific backup revision. This replaces
/// local data outright (see [`sync::restore_snapshot`]) — it is not a merge.
#[tauri::command]
pub async fn sync_restore_version(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let config = require_config(&state).await?;
    let passphrase = require_passphrase(&state).await?;
    let mut backend = sync::make_provider(config)?;

    let envelope = backend.pull_version(&id).await?;
    sync::restore_encrypted(&state.db, &envelope, &passphrase).await?;

    persist_config(&state, &backend.config()).await?;
    mark_synced(&state).await
}

/// Encrypt the full data set with a caller-supplied passphrase and write it
/// to `path`. Independent of the connected provider; the passphrase is never
/// persisted.
#[tauri::command]
pub async fn sync_file_export(
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
) -> AppResult<()> {
    if passphrase.is_empty() {
        return Err(AppError::Invalid("passphrase is required".into()));
    }
    let envelope = sync::export_encrypted(&state.db, &passphrase).await?;
    sync::write_envelope_file(&PathBuf::from(path), &envelope)
}

/// Read an encrypted vault from `path`, decrypt it with a caller-supplied
/// passphrase, and merge it into the local database (last-write-wins).
#[tauri::command]
pub async fn sync_file_import(
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
) -> AppResult<()> {
    if passphrase.is_empty() {
        return Err(AppError::Invalid("passphrase is required".into()));
    }
    let envelope = sync::read_envelope_file(&PathBuf::from(path))?;
    sync::import_encrypted(&state.db, &envelope, &passphrase).await?;
    Ok(())
}
