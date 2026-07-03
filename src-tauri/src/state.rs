use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use sqlx::SqlitePool;
use tokio::sync::oneshot;

use crate::sftp::SftpManager;
use crate::ssh::SessionManager;
use crate::update::UpdateManager;

/// Shared application state, registered with Tauri via `.manage()` and accessed
/// from commands through `State<'_, AppState>`.
pub struct AppState {
    pub db: SqlitePool,
    pub ssh: SessionManager,
    /// `Arc` so long-running transfers can move a handle onto their own thread.
    pub sftp: Arc<SftpManager>,
    /// Lives for the whole app process, so update state survives any single
    /// window (Settings) closing and reopening.
    pub update: UpdateManager,
    /// In-flight `ai_chat` requests by request id; sending on the stored
    /// channel (via `ai_chat_cancel`) aborts the request mid-stream.
    pub ai_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: SessionManager::new(),
            sftp: Arc::new(SftpManager::new()),
            update: UpdateManager::new(),
            ai_cancels: Mutex::new(HashMap::new()),
        }
    }
}
