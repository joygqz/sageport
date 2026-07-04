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
//!   it is pulled and decrypted first: success merges it in (last-write-wins),
//!   but connecting never creates a new backup. A decrypt failure returns
//!   [`ConnectOutcome::PassphraseMismatch`] so the UI can re-prompt or
//!   clear the remote history (`force: true`) without uploading local data.
//! * `sync_push` — the only connected-provider command that writes a backup.
//!   In the normal case it pull-merges first so a device that hasn't seen
//!   another device's edits can't clobber them. After a restore, it preserves
//!   the user's chosen local state and skips the pre-push merge.
//! * `sync_list_versions` / `sync_restore_version` — browse backup history
//!   and roll back. Restoring replaces local data outright (not a merge);
//!   it never uploads a backup. The next explicit `sync_push` publishes the
//!   restored state if the user wants to keep it.
//!
//! The whole connection (provider config, account label, passphrase, sync
//! bookkeeping) lives in one JSON blob under the `sync.connection` settings
//! key — per-device state that never travels in a vault snapshot.
//!
//! Local file backup (`sync_file_export` / `sync_file_import`) is a separate
//! one-shot feature, independent of the connected provider: the passphrase
//! is supplied per call and never persisted.
//!
//! Commands that merge or restore remote data can fail *after* the local
//! database changed (e.g. the upload step). The frontend therefore refetches
//! its caches on settled, not just on success.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::oneshot;

use crate::domain::now;
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::{self, oauth, ProviderConfig, ProviderKind, SyncVersion};

const CONNECTION_KEY: &str = "sync.connection";

/// Everything the active sync connection consists of, persisted as one JSON
/// blob (it is per-device state, excluded from vault snapshots by the
/// `sync.` prefix rule in [`crate::sync`]).
#[derive(Serialize, Deserialize)]
struct Connection {
    config: ProviderConfig,
    /// Human-readable account label (GitHub login, e-mail, username, ...).
    account: String,
    /// Vault passphrase; every backup this connection touches is sealed with it.
    passphrase: String,
    last_synced_at: Option<String>,
    /// Set when the user rolled back to an older backup that is not the
    /// remote head: the next push publishes local state without pre-merging
    /// the (newer) remote head back in first.
    pending_restore: bool,
}

async fn load_connection(state: &AppState) -> AppResult<Option<Connection>> {
    let Some(raw) = settings_repo::get(&state.db, CONNECTION_KEY)
        .await?
        .filter(|v| !v.is_empty())
    else {
        return Ok(None);
    };
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

/// Non-secret view of the sync state handed to the UI.
#[derive(Serialize)]
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthReady {
    pub gist: bool,
    pub gdrive: bool,
    pub onedrive: bool,
}

/// Outcome of `sync_connect`, tagged so the frontend can branch without
/// treating a passphrase mismatch as a hard error.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ConnectOutcome {
    Connected,
    /// A backup exists but the passphrase can't decrypt it. Nothing was
    /// persisted — retry with another passphrase, or `force: true` to
    /// clear the remote history without uploading a replacement backup.
    PassphraseMismatch,
}

/// Outcome of `sync_push`, so the UI can tell a real new backup from a
/// no-op where the latest backup already contains the same data.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PushOutcome {
    Pushed,
    Unchanged,
}

/// Outcome of `sync_restore_version`. `remote_synced` is true when the
/// restored revision is also the provider's latest backup; otherwise the next
/// explicit push publishes the rollback.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub remote_synced: bool,
}

/// Resolved account label returned by a completed OAuth flow.
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
    Ok(SyncStatus {
        provider: conn.as_ref().map(|c| c.config.kind()),
        detail: conn.as_ref().and_then(|c| c.config.detail()),
        account: conn.as_ref().map(|c| c.account.clone()),
        last_synced_at: conn.and_then(|c| c.last_synced_at),
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
    let value =
        settings.ok_or_else(|| AppError::Invalid("provider settings are required".into()))?;
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
    if load_connection(&state).await?.is_some() {
        return Err(AppError::Invalid(
            "sync is already connected — disconnect first to switch providers".into(),
        ));
    }
    let kind = ProviderKind::parse(&provider)?;
    let (config, account) = build_config(&state, kind, settings)?;
    let mut backend = sync::make_provider(config)?;

    // Probe the target before persisting anything. A regular connect merges
    // the existing latest backup into local data; force-connect clears
    // undecryptable remote history but never uploads a replacement backup.
    let mut last_synced_at = None;
    match backend.pull_latest().await? {
        Some(_) if force => backend.clear().await?,
        Some(envelope) => match sync::decrypt_snapshot(&envelope, &passphrase) {
            Ok(snapshot) => {
                sync::import_snapshot(&state.db, &snapshot).await?;
                last_synced_at = Some(now());
            }
            Err(AppError::Crypto(_)) => return Ok(ConnectOutcome::PassphraseMismatch),
            Err(err) => return Err(err),
        },
        None => {}
    }

    save_connection(
        &state,
        &Connection {
            config: backend.config(),
            account,
            passphrase,
            last_synced_at,
            pending_restore: false,
        },
    )
    .await?;
    state.sync_oauth.lock().pending = None;

    Ok(ConnectOutcome::Connected)
}

/// Forget the provider connection and credentials. Remote backups are left
/// untouched.
#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    settings_repo::set(&state.db, CONNECTION_KEY, "").await?;
    state.sync_oauth.lock().pending = None;
    Ok(())
}

/// Merge the remote backup into the local vault (so edits from other devices
/// survive), then push the result as a new backup revision when content
/// changed. Skipping content-identical pushes keeps the provider's limited
/// version history from filling up with redundant revisions.
#[tauri::command]
pub async fn sync_push(state: State<'_, AppState>) -> AppResult<PushOutcome> {
    let mut conn = require_connection(&state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;

    let remote = match backend.pull_latest().await? {
        Some(envelope) => Some(sync::decrypt_snapshot(&envelope, &conn.passphrase)?),
        None => None,
    };

    // Pre-merge the remote head — unless the user just rolled back to an
    // older backup, whose whole point is to override newer remote rows.
    if !conn.pending_restore {
        if let Some(snapshot) = &remote {
            sync::import_snapshot(&state.db, snapshot).await?;
        }
    }

    let local = sync::export_snapshot(&state.db).await?;
    let unchanged = remote
        .as_ref()
        .is_some_and(|r| r.content_fingerprint() == local.content_fingerprint());
    if !unchanged {
        let sealed = crate::crypto::encrypt(&serde_json::to_vec(&local)?, &conn.passphrase)?;
        backend.push(&sealed).await?;
    }

    conn.config = backend.config();
    conn.pending_restore = false;
    conn.last_synced_at = Some(now());
    save_connection(&state, &conn).await?;

    Ok(if unchanged {
        PushOutcome::Unchanged
    } else {
        PushOutcome::Pushed
    })
}

/// Backup history of the connected provider, newest first.
#[tauri::command]
pub async fn sync_list_versions(state: State<'_, AppState>) -> AppResult<Vec<SyncVersion>> {
    let mut conn = require_connection(&state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;
    let versions = backend.list_versions().await?;
    conn.config = backend.config();
    save_connection(&state, &conn).await?;
    Ok(versions)
}

/// Roll the local vault back to one specific backup revision. This replaces
/// local data outright (see [`sync::restore_snapshot`]) — it is not a merge,
/// and it never uploads anything: the user may be trying several backups, so
/// only the next explicit push publishes the chosen state.
#[tauri::command]
pub async fn sync_restore_version(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<RestoreOutcome> {
    let mut conn = require_connection(&state).await?;
    let mut backend = sync::make_provider(conn.config.clone())?;

    let target_is_latest = backend
        .list_versions()
        .await?
        .first()
        .is_some_and(|version| version.id == id);

    let envelope = backend.pull_version(&id).await?;
    sync::restore_encrypted(&state.db, &envelope, &conn.passphrase).await?;

    conn.config = backend.config();
    conn.pending_restore = !target_is_latest;
    conn.last_synced_at = Some(now());
    save_connection(&state, &conn).await?;

    Ok(RestoreOutcome {
        remote_synced: target_is_latest,
    })
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
