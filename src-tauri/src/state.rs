use std::sync::Arc;

use sqlx::SqlitePool;

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
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: SessionManager::new(),
            sftp: Arc::new(SftpManager::new()),
            update: UpdateManager::new(),
        }
    }
}
