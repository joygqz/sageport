use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use sqlx::SqlitePool;
use tokio::sync::oneshot;

use crate::pty::PtyManager;
use crate::sftp::SftpManager;
use crate::ssh::forward::ForwardManager;
use crate::ssh::monitor::MonitorManager;
use crate::ssh::{new_connection_prompts, ConnectionPrompts, SessionManager};
use crate::sync::{oauth::OAuthOutcome, ProviderKind};
use crate::update::UpdateManager;

#[derive(Default)]
pub struct SyncOAuthSlot {
    pub pending: Option<(ProviderKind, OAuthOutcome)>,
    pub cancel: Option<oneshot::Sender<()>>,
}

pub struct AppState {
    pub db: SqlitePool,
    pub ssh: Arc<SessionManager>,

    pub sftp: Arc<SftpManager>,

    pub pty: PtyManager,

    pub forwards: ForwardManager,

    pub monitor: MonitorManager,

    pub connection_prompts: ConnectionPrompts,

    pub update: UpdateManager,

    pub ai_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,

    pub batch_cancels: Mutex<HashMap<String, Option<oneshot::Sender<()>>>>,

    pub sync_oauth: Mutex<SyncOAuthSlot>,
}

impl AppState {
    pub fn new(db: SqlitePool) -> Self {
        Self {
            db,
            ssh: Arc::new(SessionManager::new()),
            sftp: Arc::new(SftpManager::new()),
            pty: PtyManager::new(),
            forwards: ForwardManager::new(),
            monitor: MonitorManager::new(),
            connection_prompts: new_connection_prompts(),
            update: UpdateManager::new(),
            ai_cancels: Mutex::new(HashMap::new()),
            batch_cancels: Mutex::new(HashMap::new()),
            sync_oauth: Mutex::new(SyncOAuthSlot::default()),
        }
    }
}
