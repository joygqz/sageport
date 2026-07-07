use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::repository::host_repo;
use crate::repository::transfer_repo::{self, TransferRow};
use crate::sftp::{self, ops, Endpoint, FileEntry, SftpConnectParams};
use crate::state::AppState;

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

#[tauri::command]
pub async fn fs_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    host_id: String,
) -> AppResult<()> {
    let host = host_repo::get(&state.db, &host_id).await?;
    let hops = super::ssh::build_hops(&state, &host).await?;

    state.sftp.connect(
        app,
        state.host_key_prompts.clone(),
        SftpConnectParams {
            connection_id,
            hops,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn fs_disconnect(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<()> {
    state.sftp.disconnect(&app, &connection_id);
    Ok(())
}

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
        Some(id) => state.sftp.realpath(&id, ".").await,
    }
}

#[tauri::command]
pub async fn fs_list(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    match connection_id {
        None => local(move || ops::local_list(&path)).await,
        Some(id) => state.sftp.list(&id, &path).await,
    }
}

#[tauri::command]
pub async fn fs_mkdir(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
) -> AppResult<()> {
    match connection_id {
        None => local(move || Ok(std::fs::create_dir(&path)?)).await,
        Some(id) => state.sftp.mkdir(&id, &path).await,
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
        None => local(move || Ok(std::fs::rename(&from, &to)?)).await,
        Some(id) => state.sftp.rename(&id, &from, &to).await,
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
            local(move || {
                if is_dir {
                    std::fs::remove_dir_all(&path)?;
                } else {
                    std::fs::remove_file(&path)?;
                }
                Ok(())
            })
            .await
        }
        Some(id) => state.sftp.remove(&id, &path, is_dir).await,
    }
}

#[tauri::command]
pub async fn fs_chmod(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
    mode: u32,
) -> AppResult<()> {
    match connection_id {
        None => local(move || ops::local_chmod(&path, mode)).await,
        Some(id) => state.sftp.chmod(&id, &path, mode).await,
    }
}

#[tauri::command]
pub async fn fs_read_text(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
) -> AppResult<String> {
    let bytes = match connection_id {
        None => {
            local(move || {
                if std::fs::metadata(&path)?.len() > sftp::MAX_EDIT_BYTES {
                    return Err(sftp::edit_too_large_error());
                }
                Ok(std::fs::read(&path)?)
            })
            .await?
        }
        Some(id) => state.sftp.read_file(&id, &path).await?,
    };
    String::from_utf8(bytes).map_err(|_| AppError::Invalid("file is not UTF-8 text".into()))
}

#[tauri::command]
pub async fn fs_write_text(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
    content: String,
) -> AppResult<()> {
    match connection_id {
        None => local(move || Ok(std::fs::write(&path, content)?)).await,
        Some(id) => state.sftp.write_file(&id, &path, content.as_bytes()).await,
    }
}

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
    tokio::spawn(async move {
        let outcome =
            sftp::transfer(&app, &mgr, &transfer_id, &source, &dest, compress, cancel).await;
        mgr.unregister_transfer(&transfer_id);
        let _ = transfer_repo::finish(
            &pool,
            &transfer_id,
            outcome.transferred,
            outcome.total,
            outcome.status,
            outcome.message.as_deref(),
        )
        .await;
    });
    Ok(())
}

#[tauri::command]
pub async fn fs_transfer_cancel(state: State<'_, AppState>, transfer_id: String) -> AppResult<()> {
    state.sftp.cancel_transfer(&transfer_id);
    Ok(())
}

#[tauri::command]
pub async fn fs_history_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<TransferHistoryEntry>> {
    let rows = transfer_repo::list(&state.db, limit.unwrap_or(200).clamp(1, 1000)).await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn fs_history_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    transfer_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn fs_history_clear(state: State<'_, AppState>) -> AppResult<()> {
    transfer_repo::clear(&state.db).await
}

async fn local<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))?
}
