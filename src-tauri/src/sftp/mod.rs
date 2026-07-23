pub mod delete;
pub mod ops;
pub mod path;
pub mod transfer;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::OnceCell;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use crate::error::{AppError, AppResult};
use crate::ssh::{establish, exec_capture, ConnectionPrompts, Hop, SshConnection};

pub use path::base_name;
pub use transfer::{transfer, Endpoint, TransferRequest};

pub const EVENT_DELETE: &str = "sftp://delete";
pub const EVENT_STATUS: &str = "sftp://status";
pub const EVENT_TRANSFER: &str = "sftp://transfer";

pub const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;
const SUBSYSTEM_OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CONCURRENT_DELETE_REQUESTS: usize = 8;
const MAX_CONCURRENT_OPERATIONS: usize = 4;

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
    pub hidden: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEvent {
    pub operation_id: String,
    pub connection_id: Option<String>,
    pub completed: u64,
    pub total: u64,
    pub current_path: String,
    pub status: String,
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// A cancellation signal that can both be polled from blocking work and wake
/// async I/O immediately. An atomic flag alone cannot interrupt a stalled
/// network read, which made transfer cancellation appear unresponsive.
pub struct TransferCancel {
    cancelled: AtomicBool,
    notify: Notify,
}

impl TransferCancel {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }

    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }
}

pub struct SftpConnectParams {
    pub connection_id: String,
    pub host_label: String,
    pub hops: Vec<Hop>,
}

pub struct Conn {
    ssh: SshConnection,
    session: SftpSession,
    host_label: String,
    tar_available: OnceCell<bool>,
    delete_slots: Arc<Semaphore>,
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

    async fn supports_tar(&self) -> bool {
        *self
            .tar_available
            .get_or_init(|| async {
                self.exec("command -v tar >/dev/null 2>&1 && printf yes")
                    .await
                    .is_ok()
            })
            .await
    }
}

pub struct SftpManager {
    conns: Arc<Mutex<HashMap<String, Arc<Conn>>>>,
    connect_cancels: Arc<Mutex<HashMap<String, Arc<TransferCancel>>>>,
    operation_cancels: Mutex<HashMap<String, Arc<TransferCancel>>>,
    operation_slots: Arc<Semaphore>,
}

impl Default for SftpManager {
    fn default() -> Self {
        Self {
            conns: Arc::new(Mutex::new(HashMap::new())),
            connect_cancels: Arc::new(Mutex::new(HashMap::new())),
            operation_cancels: Mutex::new(HashMap::new()),
            operation_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_OPERATIONS)),
        }
    }
}

impl SftpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_operation(&self, operation_id: &str) -> Arc<TransferCancel> {
        let flag = Arc::new(TransferCancel::new());
        self.operation_cancels
            .lock()
            .insert(operation_id.to_string(), flag.clone());
        flag
    }

    pub fn cancel_operation(&self, operation_id: &str) {
        if let Some(flag) = self.operation_cancels.lock().get(operation_id) {
            flag.cancel();
        }
    }

    pub fn unregister_operation(&self, operation_id: &str) {
        self.operation_cancels.lock().remove(operation_id);
    }

    pub async fn acquire_operation_slot(&self) -> OwnedSemaphorePermit {
        self.operation_slots
            .clone()
            .acquire_owned()
            .await
            .expect("transfer semaphore must stay open")
    }

    pub fn connect(&self, app: AppHandle, prompts: ConnectionPrompts, params: SftpConnectParams) {
        let id = params.connection_id.clone();
        let cancel = Arc::new(TransferCancel::new());
        {
            let mut pending = self.connect_cancels.lock();
            if self.conns.lock().contains_key(&id) || pending.contains_key(&id) {
                return;
            }
            pending.insert(id.clone(), cancel.clone());
        }
        let conns = self.conns.clone();
        let connect_cancels = self.connect_cancels.clone();
        tokio::spawn(async move {
            emit_status(&app, &id, "connecting", None);
            let result = tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(AppError::Cancelled),
                result = open(&app, &prompts, &params) => result,
            };
            match result {
                Ok(conn) => {
                    let mut pending = connect_cancels.lock();
                    let is_current = pending
                        .get(&id)
                        .is_some_and(|current| Arc::ptr_eq(current, &cancel));
                    if is_current && !cancel.is_cancelled() {
                        conns.lock().insert(id.clone(), Arc::new(conn));
                        emit_status(&app, &id, "connected", None);
                        pending.remove(&id);
                    }
                }
                Err(AppError::Cancelled) if cancel.is_cancelled() => {}
                Err(e) => {
                    let mut pending = connect_cancels.lock();
                    let is_current = pending
                        .get(&id)
                        .is_some_and(|current| Arc::ptr_eq(current, &cancel));
                    if is_current {
                        emit_status(&app, &id, "error", Some(&e));
                        pending.remove(&id);
                    }
                }
            }
            let mut pending = connect_cancels.lock();
            if pending
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &cancel))
            {
                pending.remove(&id);
            }
        });
    }

    pub fn disconnect(&self, app: &AppHandle, connection_id: &str) {
        let connecting = self.connect_cancels.lock().remove(connection_id);
        if let Some(cancel) = &connecting {
            cancel.cancel();
        }
        if connecting.is_some() || self.conns.lock().remove(connection_id).is_some() {
            emit_status(app, connection_id, "closed", None);
        }
    }

    pub fn disconnect_all(&self) {
        for (_, flag) in self.operation_cancels.lock().drain() {
            flag.cancel();
        }
        for (_, cancel) in self.connect_cancels.lock().drain() {
            cancel.cancel();
        }
        self.conns.lock().clear();
    }

    pub fn get(&self, id: &str) -> AppResult<Arc<Conn>> {
        self.conns
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("sftp connection {id}")))
    }

    pub fn host_label(&self, id: &str) -> AppResult<String> {
        Ok(self.get(id)?.host_label.clone())
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

    pub async fn write_file(
        &self,
        id: &str,
        path: &str,
        data: &[u8],
        expected: Option<&[u8]>,
    ) -> AppResult<()> {
        ops::remote_write(&self.get(id)?.session, path, data, expected).await
    }

    pub async fn chmod(&self, id: &str, path: &str, mode: u32) -> AppResult<()> {
        ops::remote_chmod(&self.get(id)?.session, path, mode).await
    }

    pub async fn exec(&self, id: &str, command: &str) -> AppResult<String> {
        self.get(id)?.exec(command).await
    }

    pub async fn supports_tar(&self, id: &str) -> bool {
        match self.get(id) {
            Ok(conn) => conn.supports_tar().await,
            Err(_) => false,
        }
    }
}

async fn open(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    params: &SftpConnectParams,
) -> AppResult<Conn> {
    let ssh = establish(app, prompts, &params.connection_id, &params.hops).await?;
    let session = tokio::time::timeout(SUBSYSTEM_OPEN_TIMEOUT, async {
        let channel = ssh.handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        Ok::<_, AppError>(SftpSession::new(channel.into_stream()).await?)
    })
    .await
    .map_err(|_| AppError::Timeout("timed out opening SFTP subsystem".into()))??;
    Ok(Conn {
        ssh,
        session,
        host_label: params.host_label.clone(),
        tar_available: OnceCell::new(),
        delete_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_DELETE_REQUESTS)),
    })
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
    code: Option<String>,
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
            code,
        },
    );
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn emit_delete_event(
    app: &AppHandle,
    operation_id: &str,
    connection_id: Option<&str>,
    completed: u64,
    total: u64,
    current_path: &str,
    status: &str,
    phase: Option<String>,
    message: Option<String>,
    code: Option<String>,
) {
    let _ = app.emit(
        EVENT_DELETE,
        DeleteEvent {
            operation_id: operation_id.to_string(),
            connection_id: connection_id.map(str::to_string),
            completed,
            total,
            current_path: current_path.to_string(),
            status: status.to_string(),
            phase,
            message,
            code,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{SftpManager, TransferCancel, MAX_CONCURRENT_OPERATIONS};
    use std::sync::Arc;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_wakes_a_waiting_io_task() {
        let cancel = Arc::new(TransferCancel::new());
        let waiting = cancel.clone();
        let task = tokio::spawn(async move { waiting.cancelled().await });

        cancel.cancel();

        tokio::time::timeout(Duration::from_millis(100), task)
            .await
            .expect("cancellation should wake immediately")
            .expect("wait task should finish");
    }

    #[test]
    fn disconnect_all_cancels_and_releases_registered_operations() {
        let manager = SftpManager::new();
        let cancel = manager.register_operation("transfer-1");

        manager.disconnect_all();

        assert!(cancel.is_cancelled());
        assert!(manager.operation_cancels.lock().is_empty());
    }

    #[tokio::test]
    async fn operation_slots_bound_concurrent_file_io() {
        let manager = SftpManager::new();
        let mut permits = Vec::new();
        for _ in 0..MAX_CONCURRENT_OPERATIONS {
            permits.push(manager.acquire_operation_slot().await);
        }

        assert!(manager.operation_slots.clone().try_acquire_owned().is_err());
        permits.pop();
        let _permit =
            tokio::time::timeout(Duration::from_secs(1), manager.acquire_operation_slot())
                .await
                .expect("released operation slot should wake the queue");
    }
}
