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
use serde::Serialize;
use tokio::sync::oneshot;

pub use connect::{establish, SshConnection};
pub use exec::exec_capture;
pub use session::SessionManager;

pub const EVENT_DATA: &str = "ssh://data";
pub const EVENT_STATUS: &str = "ssh://status";
pub const EVENT_HOST_KEY: &str = "ssh://host-key";
pub const EVENT_PASSWORD: &str = "ssh://password";
pub const EVENT_PASSWORD_CLOSED: &str = "ssh://password-closed";

pub const TERM: &str = "xterm-256color";
pub const JUMP_DEPTH_LIMIT: usize = 8;

#[derive(Debug, Clone)]
pub enum AuthMethod {
    Password(Option<String>),
    Key {
        private_key: String,
        passphrase: Option<String>,
    },
    Agent,
    Automatic,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordPromptEvent {
    pub prompt_id: String,
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordPromptClosedEvent {
    pub prompt_id: String,
}

pub struct PendingPasswordPrompt {
    pub event: PasswordPromptEvent,
    pub response: oneshot::Sender<Option<String>>,
}

pub type PasswordPrompts = Arc<Mutex<HashMap<String, PendingPasswordPrompt>>>;

#[derive(Clone)]
pub struct ConnectionPrompts {
    pub host_keys: HostKeyPrompts,
    pub passwords: PasswordPrompts,
}

pub fn new_connection_prompts() -> ConnectionPrompts {
    ConnectionPrompts {
        host_keys: Arc::new(Mutex::new(HashMap::new())),
        passwords: Arc::new(Mutex::new(HashMap::new())),
    }
}

pub fn resolve_host_key(prompts: &HostKeyPrompts, prompt_id: &str, decision: HostKeyDecision) {
    if let Some(tx) = prompts.lock().remove(prompt_id) {
        let _ = tx.send(decision);
    }
}

pub fn resolve_password(prompts: &PasswordPrompts, prompt_id: &str, password: Option<String>) {
    if let Some(prompt) = prompts.lock().remove(prompt_id) {
        let _ = prompt.response.send(password);
    }
}

pub fn pending_password_prompts(prompts: &PasswordPrompts) -> Vec<PasswordPromptEvent> {
    prompts
        .lock()
        .values()
        .map(|prompt| prompt.event.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pending_password_prompts_can_be_recovered_and_resolved() {
        let prompts = new_connection_prompts();
        let event = PasswordPromptEvent {
            prompt_id: "prompt-1".into(),
            session_id: "session-1".into(),
            host: "example.com".into(),
            port: 22,
            username: "root".into(),
        };
        let (tx, rx) = oneshot::channel();
        prompts.passwords.lock().insert(
            event.prompt_id.clone(),
            PendingPasswordPrompt {
                event: event.clone(),
                response: tx,
            },
        );

        let pending = pending_password_prompts(&prompts.passwords);
        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending.first().map(|item| item.prompt_id.as_str()),
            Some("prompt-1")
        );

        resolve_password(&prompts.passwords, "prompt-1", Some("secret".into()));
        assert_eq!(rx.await, Ok(Some("secret".into())));
        assert!(pending_password_prompts(&prompts.passwords).is_empty());
    }
}
