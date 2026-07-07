use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use sqlx::SqlitePool;
use tokio::sync::oneshot;

use crate::sftp::SftpManager;
use crate::ssh::SessionManager;
use crate::sync::{oauth::OAuthOutcome, ProviderKind};
use crate::update::UpdateManager;

#[derive(Default)]
pub struct SyncOAuthSlot {
    pub pending: Option<(ProviderKind, OAuthOutcome)>,
    pub cancel: Option<oneshot::Sender<()>>,
}

pub struct AppState {
    pub db: SqlitePool,
    pub ssh: SessionManager,

    pub sftp: Arc<SftpManager>,

    pub update: UpdateManager,

    pub ai_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,

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
