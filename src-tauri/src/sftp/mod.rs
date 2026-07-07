pub mod ops;
pub mod path;
pub mod transfer;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::ssh::{establish, exec_capture, Hop, HostKeyPrompts, SshConnection};

pub use path::base_name;
pub use transfer::{transfer, Endpoint};

pub const EVENT_STATUS: &str = "sftp://status";
pub const EVENT_TRANSFER: &str = "sftp://transfer";

pub const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

pub fn edit_too_large_error() -> AppError {
    AppError::Invalid("file is too large to edit (2 MB max)".into())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<u32>,
    pub is_symlink: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    connection_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub transfer_id: String,
    pub transferred: u64,
    pub total: u64,
    pub file: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub struct SftpConnectParams {
    pub connection_id: String,
    pub hops: Vec<Hop>,
}

pub struct Conn {
    ssh: SshConnection,
    session: SftpSession,
}

impl Conn {
    pub fn session(&self) -> &SftpSession {
        &self.session
    }

    pub async fn exec(&self, command: &str) -> AppResult<String> {
        let out = exec_capture(&self.ssh.handle, command).await?;
        if out.code != 0 {
            let detail = out.stderr.trim();
            let detail = if detail.is_empty() {
                "no output"
            } else {
                detail
            };
            return Err(AppError::Other(format!(
                "remote command failed (exit {}): {detail}",
                out.code
            )));
        }
        Ok(out.stdout)
    }
}

#[derive(Default)]
pub struct SftpManager {
    conns: Arc<Mutex<HashMap<String, Arc<Conn>>>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancel_flags
            .lock()
            .insert(transfer_id.to_string(), flag.clone());
        flag
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(flag) = self.cancel_flags.lock().get(transfer_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    pub fn unregister_transfer(&self, transfer_id: &str) {
        self.cancel_flags.lock().remove(transfer_id);
    }

    pub fn connect(&self, app: AppHandle, prompts: HostKeyPrompts, params: SftpConnectParams) {
        let id = params.connection_id.clone();
        if self.conns.lock().contains_key(&id) {
            return;
        }
        let conns = self.conns.clone();
        tokio::spawn(async move {
            emit_status(&app, &id, "connecting", None);
            match open(&app, &prompts, &params).await {
                Ok(conn) => {
                    conns.lock().insert(id.clone(), Arc::new(conn));
                    emit_status(&app, &id, "connected", None);
                }
                Err(e) => emit_status(&app, &id, "error", Some(&e)),
            }
        });
    }

    pub fn disconnect(&self, app: &AppHandle, connection_id: &str) {
        if self.conns.lock().remove(connection_id).is_some() {
            emit_status(app, connection_id, "closed", None);
        }
    }

    pub fn get(&self, id: &str) -> AppResult<Arc<Conn>> {
        self.conns
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("sftp connection {id}")))
    }

    pub async fn list(&self, id: &str, path: &str) -> AppResult<Vec<FileEntry>> {
        ops::remote_list(&self.get(id)?.session, path).await
    }

    pub async fn realpath(&self, id: &str, path: &str) -> AppResult<String> {
        ops::remote_realpath(&self.get(id)?.session, path).await
    }

    pub async fn mkdir(&self, id: &str, path: &str) -> AppResult<()> {
        ops::remote_mkdir(&self.get(id)?.session, path).await
    }

    pub async fn rename(&self, id: &str, from: &str, to: &str) -> AppResult<()> {
        ops::remote_rename(&self.get(id)?.session, from, to).await
    }

    pub async fn remove(&self, id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        ops::remote_remove(&self.get(id)?.session, path, is_dir).await
    }

    pub async fn read_file(&self, id: &str, path: &str) -> AppResult<Vec<u8>> {
        ops::remote_read(&self.get(id)?.session, path).await
    }

    pub async fn write_file(&self, id: &str, path: &str, data: &[u8]) -> AppResult<()> {
        ops::remote_write(&self.get(id)?.session, path, data).await
    }

    pub async fn chmod(&self, id: &str, path: &str, mode: u32) -> AppResult<()> {
        ops::remote_chmod(&self.get(id)?.session, path, mode).await
    }

    pub async fn exec(&self, id: &str, command: &str) -> AppResult<String> {
        self.get(id)?.exec(command).await
    }
}

async fn open(
    app: &AppHandle,
    prompts: &HostKeyPrompts,
    params: &SftpConnectParams,
) -> AppResult<Conn> {
    let ssh = establish(app, prompts, &params.connection_id, &params.hops).await?;
    let channel = ssh.handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let session = SftpSession::new(channel.into_stream()).await?;
    Ok(Conn { ssh, session })
}

pub(crate) fn emit_status(app: &AppHandle, id: &str, status: &str, err: Option<&AppError>) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            connection_id: id.to_string(),
            status: status.to_string(),
            message: err.map(|e| e.to_string()),
            code: err.map(|e| e.code().to_string()),
        },
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_transfer_event(
    app: &AppHandle,
    transfer_id: &str,
    transferred: u64,
    total: u64,
    file: &str,
    status: &str,
    phase: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_TRANSFER,
        TransferEvent {
            transfer_id: transfer_id.to_string(),
            transferred,
            total,
            file: file.to_string(),
            status: status.to_string(),
            phase,
            message,
        },
    );
}
