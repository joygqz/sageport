use std::time::Duration;

use russh::client;
use russh::keys::ssh_key::PublicKey;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::known_hosts::{self, KnownHostStatus};
use super::{HostKeyDecision, HostKeyPrompts, EVENT_HOST_KEY};

const HOST_KEY_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostKeyEvent {
    prompt_id: String,
    session_id: String,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
    status: String,
}

pub struct ClientHandler {
    pub app: AppHandle,
    pub prompts: HostKeyPrompts,
    pub session_id: String,
    pub host: String,
    pub port: u16,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let status = match known_hosts::evaluate(&self.app, &self.host, self.port, key) {
            KnownHostStatus::Trusted => return Ok(true),
            KnownHostStatus::Unknown => "unknown",
            KnownHostStatus::Changed => "changed",
        };

        let prompt_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.prompts.lock().insert(prompt_id.clone(), tx);

        let _ = self.app.emit(
            EVENT_HOST_KEY,
            HostKeyEvent {
                prompt_id: prompt_id.clone(),
                session_id: self.session_id.clone(),
                host: self.host.clone(),
                port: self.port,
                key_type: key.algorithm().to_string(),
                fingerprint: known_hosts::fingerprint(key),
                status: status.to_string(),
            },
        );

        let decision = match tokio::time::timeout(HOST_KEY_TIMEOUT, rx).await {
            Ok(Ok(decision)) => decision,
            _ => HostKeyDecision::Reject,
        };
        self.prompts.lock().remove(&prompt_id);

        match decision {
            HostKeyDecision::Reject => Ok(false),
            HostKeyDecision::AcceptOnce => Ok(true),
            HostKeyDecision::AcceptRemember => {
                known_hosts::learn(&self.app, &self.host, self.port, key);
                Ok(true)
            }
        }
    }
}
