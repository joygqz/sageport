//! Sync commands.
//!
//! Two manual paths, both built on the same encrypted snapshot:
//!   * GitHub Gist — `sync_push` backs up (merge + push); `sync_list_gist_versions`
//!     / `sync_restore_gist_version` browse and roll back to any prior backup.
//!     The token, gist id and vault passphrase all live in the settings table
//!     so the user configures them once instead of retyping a passphrase on
//!     every operation.
//!   * Local file — `sync_file_export` / `sync_file_import` for offline backup
//!     and manual restore.
//!
//! Gist discovery: the gist id is cached locally once known, but a device
//! that only has the token (e.g. a fresh install) auto-discovers the vault
//! gist created by another device on its first push/version-list, so
//! multi-device sync doesn't require copying a gist id around by hand.
//!
//! Push safety: pushing first pulls and merges whatever is already on the
//! gist (last-write-wins, keyed on `updated_at`) so a push from a device that
//! hasn't seen a teammate's edits can't silently clobber them. If the merge
//! can't be completed — the gist was deleted, or the stored passphrase
//! doesn't match what encrypted the remote data — the push is aborted with a
//! clear error instead of overwriting the remote vault.
//!
//! Restoring a specific version is a deliberate, destructive action: it
//! replaces the local vault outright (see [`sync::restore_snapshot`]) instead
//! of merging, since the whole point is to roll back rows that look newer
//! locally. The frontend is expected to confirm before calling it.

use std::path::PathBuf;

use tauri::State;

use crate::domain::now;
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::{self, GistClient, GistVersion};

const TOKEN_KEY: &str = "sync.gist.token";
const GIST_ID_KEY: &str = "sync.gist.id";
const PASSPHRASE_KEY: &str = "sync.gist.passphrase";
const LAST_SYNCED_KEY: &str = "sync.gist.last_synced_at";

/// Non-secret view of the gist sync configuration handed to the UI. The token
/// and passphrase are never returned — only whether each is stored.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    pub has_token: bool,
    pub has_passphrase: bool,
    pub gist_id: Option<String>,
    pub last_synced_at: Option<String>,
}

async fn read_token(state: &AppState) -> AppResult<String> {
    settings_repo::get(&state.db, TOKEN_KEY)
        .await?
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Invalid("no GitHub token configured for sync".into()))
}

async fn read_passphrase(state: &AppState) -> AppResult<String> {
    settings_repo::get(&state.db, PASSPHRASE_KEY)
        .await?
        .filter(|p| !p.is_empty())
        .ok_or_else(|| AppError::Invalid("no vault passphrase configured for sync".into()))
}

async fn read_gist_id(state: &AppState) -> AppResult<Option<String>> {
    Ok(settings_repo::get(&state.db, GIST_ID_KEY)
        .await?
        .filter(|id| !id.is_empty()))
}

/// Resolve the linked gist id, auto-discovering it from the token's existing
/// gists (and caching the result) when it isn't cached locally yet.
async fn resolve_gist_id(state: &AppState, token: &str) -> AppResult<Option<String>> {
    if let Some(id) = read_gist_id(state).await? {
        return Ok(Some(id));
    }
    let discovered = GistClient::new(token).find_vault_gist().await?;
    if let Some(id) = &discovered {
        settings_repo::set(&state.db, GIST_ID_KEY, id).await?;
    }
    Ok(discovered)
}

async fn mark_synced(state: &AppState) -> AppResult<()> {
    settings_repo::set(&state.db, LAST_SYNCED_KEY, &now()).await
}

#[tauri::command]
pub async fn sync_get_config(state: State<'_, AppState>) -> AppResult<SyncConfig> {
    let has_token = settings_repo::get(&state.db, TOKEN_KEY)
        .await?
        .is_some_and(|t| !t.is_empty());
    let has_passphrase = settings_repo::get(&state.db, PASSPHRASE_KEY)
        .await?
        .is_some_and(|p| !p.is_empty());
    let gist_id = read_gist_id(&state).await?;
    let last_synced_at = settings_repo::get(&state.db, LAST_SYNCED_KEY)
        .await?
        .filter(|t| !t.is_empty());
    Ok(SyncConfig {
        has_token,
        has_passphrase,
        gist_id,
        last_synced_at,
    })
}

/// Store (or, when `token` is empty, clear) the GitHub personal access token.
#[tauri::command]
pub async fn sync_set_token(state: State<'_, AppState>, token: String) -> AppResult<()> {
    let token = token.trim().to_string();
    settings_repo::set(&state.db, TOKEN_KEY, &token).await?;
    if token.is_empty() {
        return Ok(());
    }
    // Best-effort discovery so a second device links up immediately after
    // pasting its token, without needing a manual push first. Discovery
    // failures (bad token, offline) are swallowed here — the real error will
    // surface on the next explicit push/version list.
    if read_gist_id(&state).await?.is_none() {
        if let Ok(Some(id)) = GistClient::new(&token).find_vault_gist().await {
            settings_repo::set(&state.db, GIST_ID_KEY, &id).await.ok();
        }
    }
    Ok(())
}

/// Store (or, when `passphrase` is empty, clear) the vault passphrase used to
/// encrypt/decrypt every sync operation. Set once per device — it must match
/// across devices that share a gist, or backups become unreadable to each
/// other.
#[tauri::command]
pub async fn sync_set_passphrase(state: State<'_, AppState>, passphrase: String) -> AppResult<()> {
    settings_repo::set(&state.db, PASSPHRASE_KEY, &passphrase).await
}

/// Forget the token, gist id and passphrase (the remote gist itself is left
/// untouched on GitHub).
#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    settings_repo::set(&state.db, TOKEN_KEY, "").await?;
    settings_repo::set(&state.db, GIST_ID_KEY, "").await?;
    settings_repo::set(&state.db, PASSPHRASE_KEY, "").await?;
    settings_repo::set(&state.db, LAST_SYNCED_KEY, "").await
}

/// Merge the local vault with the gist (pulling+merging first when a gist is
/// linked, to avoid clobbering changes made from another device) and push the
/// result. Creates the gist on first use. Returns the gist id.
#[tauri::command]
pub async fn sync_push(state: State<'_, AppState>) -> AppResult<String> {
    let token = read_token(&state).await?;
    let passphrase = read_passphrase(&state).await?;
    let client = GistClient::new(&token);
    let mut gist_id = resolve_gist_id(&state, &token).await?;

    // Pull-merge before push: without this, a device that hasn't seen a
    // teammate's edits would overwrite them wholesale instead of merging.
    if let Some(id) = &gist_id {
        match client.pull(id).await {
            Ok(envelope) => {
                sync::import_encrypted(&state.db, &envelope, &passphrase)
                    .await
                    .map_err(|_| {
                        AppError::Invalid(
                            "could not decrypt the remote vault with this passphrase — \
                             use the passphrase that was used for the last push/restore"
                                .into(),
                        )
                    })?;
            }
            // The cached gist id points at a gist that no longer exists
            // (deleted on GitHub); forget it and push a fresh one instead of
            // failing outright.
            Err(AppError::NotFound(_)) => {
                gist_id = None;
            }
            Err(err) => return Err(err),
        }
    }

    let envelope = sync::export_encrypted(&state.db, &passphrase).await?;
    let new_id = client.push(gist_id.as_deref(), &envelope).await?;

    settings_repo::set(&state.db, GIST_ID_KEY, &new_id).await?;
    mark_synced(&state).await?;
    Ok(new_id)
}

/// List the linked gist's backup history, newest first.
#[tauri::command]
pub async fn sync_list_gist_versions(state: State<'_, AppState>) -> AppResult<Vec<GistVersion>> {
    let token = read_token(&state).await?;
    let gist_id = resolve_gist_id(&state, &token).await?.ok_or_else(|| {
        AppError::NotFound("no backups yet — back up once from any device first".into())
    })?;
    GistClient::new(&token).list_versions(&gist_id).await
}

/// Roll the local vault back to one specific historical revision of the
/// gist. This replaces local data outright (see [`sync::restore_snapshot`]) —
/// it is not a merge, unlike every other sync path.
#[tauri::command]
pub async fn sync_restore_gist_version(state: State<'_, AppState>, sha: String) -> AppResult<()> {
    let token = read_token(&state).await?;
    let passphrase = read_passphrase(&state).await?;
    let gist_id = resolve_gist_id(&state, &token)
        .await?
        .ok_or_else(|| AppError::NotFound("no vault gist linked yet".into()))?;

    let envelope = GistClient::new(&token).pull_at(&gist_id, &sha).await?;
    sync::restore_encrypted(&state.db, &envelope, &passphrase).await?;
    mark_synced(&state).await
}

/// Encrypt the full data set with the configured passphrase and write it to
/// `path`.
#[tauri::command]
pub async fn sync_file_export(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let passphrase = read_passphrase(&state).await?;
    let envelope = sync::export_encrypted(&state.db, &passphrase).await?;
    sync::write_envelope_file(&PathBuf::from(path), &envelope)
}

/// Read an encrypted vault from `path`, decrypt it with the configured
/// passphrase, and merge it into the local database (last-write-wins).
#[tauri::command]
pub async fn sync_file_import(state: State<'_, AppState>, path: String) -> AppResult<()> {
    let passphrase = read_passphrase(&state).await?;
    let envelope = sync::read_envelope_file(&PathBuf::from(path))?;
    sync::import_encrypted(&state.db, &envelope, &passphrase).await
}
