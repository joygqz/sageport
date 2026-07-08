pub mod agent;
pub mod config_file;
pub mod connect;
pub mod exec;
pub mod forward;
pub mod handler;
pub mod known_hosts;
pub mod monitor;
pub mod session;

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio::sync::oneshot;

pub use connect::{establish, SshConnection};
pub use exec::exec_capture;
pub use session::SessionManager;

pub const EVENT_DATA: &str = "ssh://data";
pub const EVENT_STATUS: &str = "ssh://status";
pub const EVENT_HOST_KEY: &str = "ssh://host-key";

pub const TERM: &str = "xterm-256color";
pub const JUMP_DEPTH_LIMIT: usize = 8;

#[derive(Debug, Clone)]
pub enum AuthMethod {
    Password(String),
    Key {
        private_key: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone)]
pub struct Hop {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub session_id: String,
    pub attempt: u32,
    pub hops: Vec<Hop>,
    pub cols: u32,
    pub rows: u32,
    pub startup_command: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum HostKeyDecision {
    Reject,
    AcceptOnce,
    AcceptRemember,
}

pub type HostKeyPrompts = Arc<Mutex<HashMap<String, oneshot::Sender<HostKeyDecision>>>>;

pub fn new_host_key_prompts() -> HostKeyPrompts {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn resolve_host_key(prompts: &HostKeyPrompts, prompt_id: &str, decision: HostKeyDecision) {
    if let Some(tx) = prompts.lock().remove(prompt_id) {
        let _ = tx.send(decision);
    }
}
