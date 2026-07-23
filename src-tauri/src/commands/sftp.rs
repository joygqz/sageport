use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::repository::host_repo;
use crate::repository::transfer_repo::{self, TransferRow};
use crate::sftp::{self, ops, Endpoint, FileEntry, SftpConnectParams};
use crate::state::AppState;

const MAX_CONNECTION_ID_BYTES: usize = 128;
const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_TRANSFER_ID_BYTES: usize = 128;

fn validate_connection_id(connection_id: &str) -> AppResult<()> {
    if connection_id.trim().is_empty() || connection_id.len() > MAX_CONNECTION_ID_BYTES {
        return Err(AppError::Invalid("invalid SFTP connection id".into()));
    }
    Ok(())
}

fn validate_optional_connection_id(connection_id: Option<&str>) -> AppResult<()> {
    if let Some(connection_id) = connection_id {
        validate_connection_id(connection_id)?;
    }
    Ok(())
}

fn validate_path(path: &str) -> AppResult<()> {
    if path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0') {
        return Err(AppError::Invalid("invalid file path".into()));
    }
    Ok(())
}

fn validate_transfer_id(transfer_id: &str) -> AppResult<()> {
    if transfer_id.is_empty()
        || transfer_id.len() > MAX_TRANSFER_ID_BYTES
        || !transfer_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::Invalid("invalid transfer id".into()));
    }
    Ok(())
}

fn validate_endpoint(endpoint: &EndpointInput) -> AppResult<()> {
    validate_optional_connection_id(endpoint.connection_id.as_deref())?;
    validate_path(&endpoint.path)
}

fn validate_mode(mode: u32) -> AppResult<()> {
    if mode > 0o777 {
        return Err(AppError::Invalid(
            "file mode must be between 000 and 777".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointInput {
    pub connection_id: Option<String>,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEntryInput {
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
    pub source_host_label: Option<String>,
    pub dest_path: String,
    pub dest_connection_id: Option<String>,
    pub dest_host_label: Option<String>,
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
            source_host_label: row.source_host_label,
            dest_path: row.dest_path,
            dest_connection_id: row.dest_connection_id,
            dest_host_label: row.dest_host_label,
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
    validate_connection_id(&connection_id)?;
    if host_id.trim().is_empty() || host_id.len() > MAX_CONNECTION_ID_BYTES {
        return Err(AppError::Invalid("invalid host id".into()));
    }
    let host = host_repo::get(&state.db, &host_id).await?;
    let hops = super::ssh::build_hops(&state, &host).await?;
    host_repo::touch_last_used(&state.db, &host_id).await?;

    state.sftp.connect(
        app,
        state.connection_prompts.clone(),
        SftpConnectParams {
            connection_id,
            host_label: host.label,
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
    validate_connection_id(&connection_id)?;
    state.sftp.disconnect(&app, &connection_id);
    Ok(())
}

#[tauri::command]
pub async fn fs_home(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> AppResult<String> {
    validate_optional_connection_id(connection_id.as_deref())?;
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
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
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
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
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
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&from)?;
    validate_path(&to)?;
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
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
    match connection_id {
        None => local(move || ops::local_remove(&path)).await,
        Some(id) => state.sftp.remove(&id, &path, is_dir).await,
    }
}

#[tauri::command]
pub async fn fs_delete_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    operation_id: String,
    connection_id: Option<String>,
    entries: Vec<DeleteEntryInput>,
) -> AppResult<()> {
    validate_transfer_id(&operation_id)?;
    validate_optional_connection_id(connection_id.as_deref())?;
    if entries.is_empty() || entries.len() > 10_000 {
        return Err(AppError::Invalid(
            "delete operation must contain between 1 and 10000 entries".into(),
        ));
    }
    let mut paths = Vec::with_capacity(entries.len());
    for entry in entries {
        validate_path(&entry.path)?;
        paths.push(entry.path);
    }
    let manager = state.sftp.clone();
    if let Some(connection_id) = connection_id.as_deref() {
        manager.get(connection_id)?;
    }
    let cancel = manager.register_operation(&operation_id)?;
    let registered_cancel = cancel.clone();
    tokio::spawn(async move {
        let permit = tokio::select! {
            biased;
            _ = cancel.cancelled() => None,
            permit = manager.acquire_operation_slot() => Some(permit),
        };
        sftp::delete::delete(
            &app,
            &manager,
            sftp::delete::DeleteRequest {
                operation_id: operation_id.clone(),
                connection_id,
                paths,
            },
            cancel,
        )
        .await;
        drop(permit);
        manager.unregister_operation(&operation_id, &registered_cancel);
    });
    Ok(())
}

#[tauri::command]
pub async fn fs_delete_cancel(state: State<'_, AppState>, operation_id: String) -> AppResult<()> {
    validate_transfer_id(&operation_id)?;
    state.sftp.cancel_operation(&operation_id);
    Ok(())
}

#[tauri::command]
pub async fn fs_chmod(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    path: String,
    mode: u32,
) -> AppResult<()> {
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
    validate_mode(mode)?;
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
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
    let bytes = match connection_id {
        None => local(move || ops::local_read(&path)).await?,
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
    expected_content: Option<String>,
) -> AppResult<()> {
    validate_optional_connection_id(connection_id.as_deref())?;
    validate_path(&path)?;
    if content.len() as u64 > sftp::MAX_EDIT_BYTES {
        return Err(sftp::edit_too_large_error());
    }
    match connection_id {
        None => {
            local(move || {
                ops::local_write(
                    &path,
                    content.as_bytes(),
                    expected_content.as_deref().map(str::as_bytes),
                )
            })
            .await
        }
        Some(id) => {
            state
                .sftp
                .write_file(
                    &id,
                    &path,
                    content.as_bytes(),
                    expected_content.as_deref().map(str::as_bytes),
                )
                .await
        }
    }
}

#[tauri::command]
pub async fn fs_transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    transfer_id: String,
    source: EndpointInput,
    dest: EndpointInput,
    target_name: Option<String>,
    overwrite: Option<bool>,
) -> AppResult<()> {
    validate_transfer_id(&transfer_id)?;
    validate_endpoint(&source)?;
    validate_endpoint(&dest)?;
    let source_name = sftp::base_name(&source.path);
    if source_name.is_empty() || matches!(source_name.as_str(), "." | "..") {
        return Err(AppError::Invalid(
            "source path has no transferable name".into(),
        ));
    }
    let target_name = target_name.unwrap_or_else(|| source_name.clone());
    if target_name.is_empty()
        || target_name == "."
        || target_name == ".."
        || target_name.contains(['/', '\\', '\0'])
        || target_name.len() > 1024
    {
        return Err(AppError::Invalid("invalid transfer target name".into()));
    }
    let mgr = state.sftp.clone();
    let pool = state.db.clone();
    let source: Endpoint = source.into();
    let dest: Endpoint = dest.into();
    let source_host_label = source
        .connection_id
        .as_deref()
        .and_then(|id| mgr.host_label(id).ok());
    let dest_host_label = dest
        .connection_id
        .as_deref()
        .and_then(|id| mgr.host_label(id).ok());
    let cancel = mgr.register_operation(&transfer_id)?;
    let registered_cancel = cancel.clone();
    if let Err(error) = transfer_repo::create(
        &pool,
        &transfer_id,
        &sftp::base_name(&source.path),
        &source.path,
        source.connection_id.as_deref(),
        source_host_label.as_deref(),
        &dest.path,
        dest.connection_id.as_deref(),
        dest_host_label.as_deref(),
    )
    .await
    {
        mgr.unregister_operation(&transfer_id, &registered_cancel);
        return Err(error);
    }
    tokio::spawn(async move {
        let permit = tokio::select! {
            biased;
            _ = cancel.cancelled() => None,
            permit = mgr.acquire_operation_slot() => Some(permit),
        };
        let outcome = sftp::transfer(
            &app,
            &mgr,
            sftp::TransferRequest {
                transfer_id: &transfer_id,
                source: &source,
                dest_dir: &dest,
                target_name: &target_name,
                overwrite: overwrite.unwrap_or(false),
            },
            cancel,
        )
        .await;
        drop(permit);
        mgr.unregister_operation(&transfer_id, &registered_cancel);
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
    validate_transfer_id(&transfer_id)?;
    state.sftp.cancel_operation(&transfer_id);
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
    validate_transfer_id(&id)?;
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

#[cfg(test)]
mod tests {
    use super::{
        validate_connection_id, validate_endpoint, validate_mode, validate_path,
        validate_transfer_id, EndpointInput, MAX_PATH_BYTES,
    };

    #[test]
    fn validates_connection_ids_and_paths() {
        assert!(validate_connection_id("").is_err());
        assert!(validate_connection_id(&"x".repeat(129)).is_err());
        assert!(validate_connection_id("sftp-1").is_ok());

        assert!(validate_path("").is_err());
        assert!(validate_path("bad\0path").is_err());
        assert!(validate_path(&"x".repeat(MAX_PATH_BYTES + 1)).is_err());
        assert!(validate_path("/home/user").is_ok());
    }

    #[test]
    fn rejects_modes_outside_the_supported_permission_bits() {
        assert!(validate_mode(0o000).is_ok());
        assert!(validate_mode(0o777).is_ok());
        assert!(validate_mode(0o1000).is_err());
    }

    #[test]
    fn validates_transfer_ids_and_endpoints_before_persisting_them() {
        assert!(validate_transfer_id("transfer_01-a").is_ok());
        assert!(validate_transfer_id("").is_err());
        assert!(validate_transfer_id("bad/id").is_err());
        assert!(validate_transfer_id(&"x".repeat(129)).is_err());

        assert!(validate_endpoint(&EndpointInput {
            connection_id: Some("remote-1".into()),
            path: "/srv/file".into(),
        })
        .is_ok());
        assert!(validate_endpoint(&EndpointInput {
            connection_id: Some("".into()),
            path: "/srv/file".into(),
        })
        .is_err());
    }
}
