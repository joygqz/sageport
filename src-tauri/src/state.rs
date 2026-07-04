use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use sqlx::SqlitePool;
use tokio::sync::oneshot;

use crate::sftp::SftpManager;
use crate::ssh::SessionManager;
use crate::sync::{oauth::OAuthOutcome, ProviderKind};
use crate::update::UpdateManager;

/// In-flight / completed-but-unclaimed OAuth state for sync.
///
/// A finished flow parks its credential in `pending` so tokens never cross
/// into the webview; `sync_connect` claims it. `cancel` aborts the flow that
/// is currently waiting on the browser or device-code poll.
#[derive(Default)]
pub struct SyncOAuthSlot {
    pub pending: Option<(ProviderKind, OAuthOutcome)>,
    pub cancel: Option<oneshot::Sender<()>>,
}

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
    /// Sync OAuth handoff between `sync_oauth_start` and `sync_connect`.
    pub sync_oauth: Mutex<SyncOAuthSlot>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: SessionManager::new(),
            sftp: Arc::new(SftpManager::new()),
            update: UpdateManager::new(),
            ai_cancels: Mutex::new(HashMap::new()),
            sync_oauth: Mutex::new(SyncOAuthSlot::default()),
        }
    }
}
