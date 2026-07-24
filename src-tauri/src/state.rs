use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use sqlx::SqlitePool;
use tokio::sync::oneshot;

use crate::pty::PtyManager;
use crate::sftp::{SftpManager, TransferCancel};
use crate::ssh::forward::ForwardManager;
use crate::ssh::monitor::MonitorManager;
use crate::ssh::{new_connection_prompts, ConnectionPrompts, SessionManager};
use crate::sync::{oauth::OAuthOutcome, ProviderKind};
use crate::update::UpdateManager;

#[derive(Default)]
pub struct SyncOAuthSlot {
    pub pending: Option<(ProviderKind, OAuthOutcome)>,
    pub cancel: Option<oneshot::Sender<()>>,
    pub generation: u64,
}

pub struct CancelEntry {
    pub generation: u64,
    pub sender: Option<oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct SyncRuntime {
    pub active_operations: usize,
    pub last_error: Option<String>,
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

    pub ai_cancels: Mutex<HashMap<String, CancelEntry>>,

    pub batch_cancels: Mutex<HashMap<String, CancelEntry>>,

    pub task_cancels: Mutex<HashMap<String, Arc<TransferCancel>>>,

    request_generation: AtomicU64,

    pub sync_oauth: Mutex<SyncOAuthSlot>,

    pub sync_operation: tokio::sync::Mutex<()>,
    pub sync_runtime: Mutex<SyncRuntime>,
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
            task_cancels: Mutex::new(HashMap::new()),
            request_generation: AtomicU64::new(0),
            sync_oauth: Mutex::new(SyncOAuthSlot::default()),
            sync_operation: tokio::sync::Mutex::new(()),
            sync_runtime: Mutex::new(SyncRuntime::default()),
        }
    }

    pub fn next_request_generation(&self) -> u64 {
        self.request_generation.fetch_add(1, Ordering::Relaxed) + 1
    }
}
