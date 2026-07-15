use std::time::Duration;

use russh::client;
use russh::keys::ssh_key::PublicKey;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, watch};

use super::known_hosts::{self, KnownHostStatus};
use super::{
    HostKeyDecision, HostKeyEvent, HostKeyPromptClosedEvent, HostKeyPrompts, PendingHostKeyPrompt,
    EVENT_HOST_KEY, EVENT_HOST_KEY_CLOSED,
};

const HOST_KEY_TIMEOUT: Duration = Duration::from_secs(15 * 60);

struct HostKeyPromptGuard {
    app: AppHandle,
    prompts: HostKeyPrompts,
    prompt_id: String,
    activity: watch::Sender<bool>,
}

impl Drop for HostKeyPromptGuard {
    fn drop(&mut self) {
        self.prompts.lock().remove(&self.prompt_id);
        let _ = self.activity.send(false);
        let _ = self.app.emit(
            EVENT_HOST_KEY_CLOSED,
            HostKeyPromptClosedEvent {
                prompt_id: self.prompt_id.clone(),
            },
        );
    }
}

pub struct ClientHandler {
    pub app: AppHandle,
    pub prompts: HostKeyPrompts,
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub host_key_activity: watch::Sender<bool>,
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
        let _ = self.host_key_activity.send(true);
        let event = HostKeyEvent {
            prompt_id: prompt_id.clone(),
            session_id: self.session_id.clone(),
            host: self.host.clone(),
            port: self.port,
            key_type: key.algorithm().to_string(),
            fingerprint: known_hosts::fingerprint(key),
            status: status.to_string(),
        };
        self.prompts.lock().insert(
            prompt_id.clone(),
            PendingHostKeyPrompt {
                event: event.clone(),
                response: tx,
            },
        );
        let _guard = HostKeyPromptGuard {
            app: self.app.clone(),
            prompts: self.prompts.clone(),
            prompt_id,
            activity: self.host_key_activity.clone(),
        };

        let _ = self.app.emit(EVENT_HOST_KEY, event);

        let decision = match tokio::time::timeout(HOST_KEY_TIMEOUT, rx).await {
            Ok(Ok(decision)) => decision,
            _ => HostKeyDecision::Reject,
        };
        match decision {
            HostKeyDecision::Reject => Ok(false),
            HostKeyDecision::AcceptOnce => Ok(true),
            HostKeyDecision::AcceptRemember => {
                known_hosts::learn(&self.app, &self.host, self.port, key)
                    .map_err(russh::Error::from)?;
                Ok(true)
            }
        }
    }
}
