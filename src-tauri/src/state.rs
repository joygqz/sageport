use std::sync::Arc;

use sqlx::SqlitePool;

use crate::sftp::SftpManager;
use crate::ssh::SessionManager;

/// Shared application state, registered with Tauri via `.manage()` and accessed
/// from commands through `State<'_, AppState>`.
pub struct AppState {
    pub db: SqlitePool,
    pub ssh: SessionManager,
    /// `Arc` so long-running transfers can move a handle onto their own thread.
    pub sftp: Arc<SftpManager>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: SessionManager::new(),
            sftp: Arc::new(SftpManager::new()),
        }
    }
}
