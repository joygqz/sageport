//! SFTP / filesystem commands.
//!
//! A `connection_id` of `None` targets the **local** filesystem (served inline
//! with `std::fs`); `Some(id)` targets a **remote** connection managed by
//! [`crate::sftp::SftpManager`]. Connections reuse a host's stored credentials
//! via [`crate::commands::ssh::resolve_credentials`].

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::repository::host_repo;
use crate::repository::transfer_repo::{self, TransferRow};
use crate::sftp::{self, Endpoint, FileEntry, SftpConnectParams, SftpManager};
use crate::state::AppState;

fn valid_port(port: i64) -> AppResult<u16> {
    let port = u16::try_from(port)
        .map_err(|_| AppError::Invalid("port must be between 1 and 65535".into()))?;
    if port == 0 {
        return Err(AppError::Invalid("port must be between 1 and 65535".into()));
    }
    Ok(port)
}

/// One end of a transfer, as sent from the frontend.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInput {
    pub connection_id: Option<String>,
    pub path: String,
}

impl From<EndpointInput> for Endpoint {
    fn from(input: EndpointInput) -> Self {
        Endpoint {
            connection_id: input.connection_id,
            path: input.path,
        }
    }
}

/// A completed or in-flight transfer, as persisted in `sftp_transfers` and
/// sent to the frontend for the history view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferHistoryEntry {
    pub id: String,
    pub source_label: String,
    pub source_path: String,
    pub source_connection_id: Option<String>,
    pub dest_path: String,
    pub dest_connection_id: Option<String>,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub status: String,
    pub message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

impl From<TransferRow> for TransferHistoryEntry {
    fn from(row: TransferRow) -> Self {
        Self {
            id: row.id,
            source_label: row.source_label,
            source_path: row.source_path,
            source_connection_id: row.source_connection_id,
            dest_path: row.dest_path,
            dest_connection_id: row.dest_connection_id,
            total_bytes: row.total_bytes,
            transferred_bytes: row.transferred_bytes,
            status: row.status,
            message: row.message,
            started_at: row.started_at,
            finished_at: row.finished_at,
        }
    }
}

/// Open a remote SFTP connection for `host_id` under `connection_id`. Returns
/// immediately; progress arrives via `sftp://status` events. Call `fs_home`
/// once the connection reports "connected".
#[tauri::command]
pub async fn sftp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    host_id: String,
) -> AppResult<()> {
    let host = host_repo::get(&state.db, &host_id).await?;
    let (username, auth) = super::ssh::resolve_credentials(&state, &host).await?;

    let params = SftpConnectParams {
        connection_id,
        host: host.address.clone(),
        port: valid_port(host.port)?,
        username,
        auth,
    };

    state.sftp.connect(app, params)?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_disconnect(state: State<'_, AppState>, connection_id: String) -> AppResult<()> {
    state.sftp.disconnect(&connection_id);
    Ok(())
}

/// Resolve the starting directory: the local home dir, or the remote home
/// (`realpath(".")`).
#[tauri::command]
pub async fn fs_home(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> AppResult<String> {
    match connection_id {
        None => {
            let home = app
                .path()
                .home_dir()
                .map_err(|e| AppError::Other(format!("home dir unavailable: {e}")))?;
            Ok(home.to_string_lossy().into_owned())
        }
        Some(id) => blocking(state.sftp.clone(), move |mgr| mgr.realpath(&id, ".")).await,
    }
}

#[tauri::command]
pub async fn fs_list(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    match connection_id {
        None => blocking_local(move || sftp::local_list(&path)).await,
        Some(id) => blocking(state.sftp.clone(), move |mgr| mgr.list(&id, &path)).await,
    }
}

#[tauri::command]
pub async fn fs_mkdir(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    match connection_id {
        None => blocking_local(move || Ok(std::fs::create_dir(&path)?)).await,
        Some(id) => blocking(state.sftp.clone(), move |mgr| mgr.mkdir(&id, &path)).await,
    }
}

#[tauri::command]
pub async fn fs_rename(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    from: String,
    to: String,
) -> AppResult<()> {
    match connection_id {
        None => blocking_local(move || Ok(std::fs::rename(&from, &to)?)).await,
        Some(id) => blocking(state.sftp.clone(), move |mgr| mgr.rename(&id, &from, &to)).await,
    }
}

#[tauri::command]
pub async fn fs_delete(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    match connection_id {
        None => {
            blocking_local(move || {
                if is_dir {
                    std::fs::remove_dir_all(&path)?;
                } else {
                    std::fs::remove_file(&path)?;
                }
                Ok(())
            })
            .await
        }
        Some(id) => {
            blocking(state.sftp.clone(), move |mgr| {
                mgr.remove(&id, &path, is_dir)
            })
            .await
        }
    }
}

/// Copy `source` into the directory `dest`. Runs on its own thread; progress is
/// reported via `sftp://transfer` events keyed by `transfer_id`. When `compress`
/// is set and `source` is a directory crossing the network, it is shipped as a
/// single `tar.gz` and unpacked at the destination. A history row is recorded
/// up front and finalized once the transfer settles, so it survives even if
/// the app is closed mid-transfer (left as `"active"`). Cancel with
/// [`fs_transfer_cancel`].
#[tauri::command]
pub async fn fs_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
    source: EndpointInput,
    dest: EndpointInput,
    compress: bool,
) -> AppResult<()> {
    let mgr = state.sftp.clone();
    let pool = state.db.clone();
    let source: Endpoint = source.into();
    let dest: Endpoint = dest.into();
    transfer_repo::create(
        &pool,
        &transfer_id,
        &sftp::base_name(&source.path),
        &source.path,
        source.connection_id.as_deref(),
        &dest.path,
        dest.connection_id.as_deref(),
    )
    .await?;

    let cancel = mgr.register_transfer(&transfer_id);
    let cleanup_mgr = mgr.clone();
    let cleanup_pool = pool.clone();
    let cleanup_transfer_id = transfer_id.clone();
    let thread_transfer_id = transfer_id.clone();
    let spawn = std::thread::Builder::new()
        .name(format!("sftp-xfer-{transfer_id}"))
        .spawn(move || {
            // `transfer` already emits a terminal done/error/cancelled event on
            // its own; here we just persist the outcome to history.
            let outcome = sftp::transfer(
                &app,
                &mgr,
                &thread_transfer_id,
                &source,
                &dest,
                compress,
                cancel,
            );
            mgr.unregister_transfer(&thread_transfer_id);
            tauri::async_runtime::block_on(async {
                let _ = transfer_repo::finish(
                    &pool,
                    &thread_transfer_id,
                    outcome.transferred,
                    outcome.total,
                    outcome.status,
                    outcome.message.as_deref(),
                )
                .await;
            });
        });
    if let Err(err) = spawn {
        cleanup_mgr.unregister_transfer(&cleanup_transfer_id);
        let message = err.to_string();
        let _ = transfer_repo::finish(
            &cleanup_pool,
            &cleanup_transfer_id,
            0,
            0,
            "error",
            Some(&message),
        )
        .await;
        return Err(AppError::Io(err));
    }
    Ok(())
}

/// Request cancellation of an in-flight transfer. Best-effort: it stops
/// between chunks/files rather than instantly.
#[tauri::command]
pub async fn fs_transfer_cancel(state: State<'_, AppState>, transfer_id: String) -> AppResult<()> {
    state.sftp.cancel_transfer(&transfer_id);
    Ok(())
}

/// Newest-first transfer history (capped at `limit`, default 200).
#[tauri::command]
pub async fn sftp_transfer_history_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<TransferHistoryEntry>> {
    let rows = transfer_repo::list(&state.db, limit.unwrap_or(200).clamp(1, 1000)).await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Remove a single transfer history entry.
#[tauri::command]
pub async fn sftp_transfer_history_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    transfer_repo::delete(&state.db, &id).await
}

/// Clear all transfer history.
#[tauri::command]
pub async fn sftp_transfer_history_clear(state: State<'_, AppState>) -> AppResult<()> {
    transfer_repo::clear(&state.db).await
}

/// Run a remote SFTP operation off the async runtime (it blocks on the worker).
async fn blocking<T, F>(mgr: Arc<SftpManager>, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&SftpManager) -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&mgr))
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))?
}

/// Run a blocking local-filesystem operation off the async runtime.
async fn blocking_local<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))?
}
