use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use russh::client::{self, ChannelOpenHandle, Msg};
use russh::keys::PublicKeyOrCertificate;
use russh::Channel;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch, OwnedSemaphorePermit, Semaphore};

use super::known_hosts::{self, KnownHostStatus};
use super::{
    HostKeyDecision, HostKeyEvent, HostKeyPromptClosedEvent, HostKeyPrompts, PendingHostKeyPrompt,
    EVENT_HOST_KEY, EVENT_HOST_KEY_CLOSED,
};

const HOST_KEY_TIMEOUT: Duration = Duration::from_secs(15 * 60);

pub struct ForwardedTcpIp {
    pub stream: russh::ChannelStream<Msg>,
    pub permit: OwnedSemaphorePermit,
}

#[derive(Clone)]
pub struct ForwardedTcpIpRoute {
    pub port: u16,
    pub sender: mpsc::Sender<ForwardedTcpIp>,
    pub requested: Arc<AtomicBool>,
    pub capacity: Arc<Semaphore>,
}

impl ForwardedTcpIpRoute {
    pub async fn forward(&self, channel: Channel<Msg>, port: u32, reply: ChannelOpenHandle) {
        if !self.requested.load(Ordering::Acquire) || port != u32::from(self.port) {
            return;
        }
        let Ok(connection_permit) = self.capacity.clone().try_acquire_owned() else {
            return;
        };
        let Ok(permit) = self.sender.clone().try_reserve_owned() else {
            return;
        };
        reply.accept().await;
        permit.send(ForwardedTcpIp {
            stream: channel.into_stream(),
            permit: connection_permit,
        });
    }
}

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
    pub shutdown: Option<watch::Receiver<bool>>,
    pub forwarded_tcpip: Option<ForwardedTcpIpRoute>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key_or_certificate: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        if self
            .shutdown
            .as_ref()
            .is_some_and(|shutdown| *shutdown.borrow())
        {
            return Ok(false);
        }
        let key = key_or_certificate.public_key();
        let status = match known_hosts::evaluate(&self.host, self.port, &key) {
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
            fingerprint: known_hosts::fingerprint(&key),
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

        let decision = host_key_decision(rx, &mut self.shutdown).await;
        match decision {
            HostKeyDecision::Reject => Ok(false),
            HostKeyDecision::AcceptOnce => Ok(true),
            HostKeyDecision::AcceptRemember => {
                known_hosts::learn(&self.host, self.port, &key).map_err(russh::Error::from)?;
                Ok(true)
            }
        }
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(route) = &self.forwarded_tcpip {
            route.forward(channel, connected_port, reply).await;
        }
        Ok(())
    }
}

async fn host_key_decision(
    response: oneshot::Receiver<HostKeyDecision>,
    shutdown: &mut Option<watch::Receiver<bool>>,
) -> HostKeyDecision {
    tokio::select! {
        biased;
        _ = async {
            match shutdown {
                Some(shutdown) => super::forward::wait_for_shutdown(shutdown).await,
                None => std::future::pending::<()>().await,
            }
        } => HostKeyDecision::Reject,
        result = tokio::time::timeout(HOST_KEY_TIMEOUT, response) => match result {
            Ok(Ok(decision)) => decision,
            _ => HostKeyDecision::Reject,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn forward_shutdown_cancels_host_key_wait_even_if_no_ui_is_listening() {
        let (_response, response) = oneshot::channel();
        let (shutdown, receiver) = watch::channel(false);
        let task =
            tokio::spawn(async move { host_key_decision(response, &mut Some(receiver)).await });
        shutdown.send(true).unwrap();
        let decision = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(decision, HostKeyDecision::Reject));
    }

    #[tokio::test]
    async fn regular_connections_still_receive_host_key_decisions() {
        let (sender, response) = oneshot::channel();
        sender.send(HostKeyDecision::AcceptOnce).unwrap();
        assert!(matches!(
            host_key_decision(response, &mut None).await,
            HostKeyDecision::AcceptOnce
        ));
    }
    #[tokio::test]
    async fn forward_shutdown_takes_priority_over_a_simultaneous_host_key_acceptance() {
        let (sender, response) = oneshot::channel();
        let (_shutdown, receiver) = watch::channel(true);
        sender.send(HostKeyDecision::AcceptRemember).unwrap();
        assert!(matches!(
            host_key_decision(response, &mut Some(receiver)).await,
            HostKeyDecision::Reject
        ));
    }
}
