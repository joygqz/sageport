use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinSet;
use tokio::time::{Instant, MissedTickBehavior};

use super::connect::{establish, establish_with_forwarded_tcpip, SshConnection};
use super::handler::ForwardedTcpIp;
use super::{ConnectionPrompts, Hop};
use crate::error::{AppError, AppResult};

pub const EVENT_STATUS: &str = "forward://status";

const BIND_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const SOCKS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECTION_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const RECONNECT_DELAY_MAX: Duration = Duration::from_secs(30);
const MAX_FORWARD_CONNECTIONS: usize = 256;

pub mod kind {
    pub const DYNAMIC: &str = "dynamic";
    pub const REMOTE: &str = "remote";
}

#[derive(Clone, PartialEq, Eq)]
pub struct ForwardSpec {
    pub id: String,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub hops: Vec<Hop>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub forward_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconnect_attempt: Option<u32>,
    pub generation: u64,
    pub sequence: u64,
}

struct ActiveForward {
    generation: u64,
    spec: ForwardSpec,
    shutdown: watch::Sender<bool>,
    finished: watch::Receiver<bool>,
}

struct RetiringForward {
    generation: u64,
    finished: watch::Receiver<bool>,
}

#[derive(Default)]
pub struct ForwardManager {
    active: Arc<Mutex<HashMap<String, ActiveForward>>>,
    retiring: Arc<Mutex<HashMap<String, RetiringForward>>>,
    runtime: Arc<Mutex<HashMap<String, StatusEvent>>>,
    next_generation: Arc<AtomicU64>,
    next_sequence: Arc<AtomicU64>,
    lifecycle: Arc<AtomicU64>,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn active_ids(&self) -> Vec<String> {
        self.active.lock().keys().cloned().collect()
    }

    pub fn active_specs(&self) -> Vec<ForwardSpec> {
        self.active
            .lock()
            .values()
            .map(|entry| entry.spec.clone())
            .collect()
    }

    pub fn runtime(&self) -> Vec<StatusEvent> {
        self.runtime.lock().values().cloned().collect()
    }

    pub async fn start(
        &self,
        app: AppHandle,
        prompts: ConnectionPrompts,
        spec: ForwardSpec,
    ) -> AppResult<()> {
        let lifecycle = self.lifecycle.load(Ordering::Acquire);
        loop {
            if self.active.lock().contains_key(&spec.id) {
                return Ok(());
            }
            let retiring = self
                .retiring
                .lock()
                .get(&spec.id)
                .map(|entry| (entry.generation, entry.finished.clone()));
            let Some((generation, retiring)) = retiring else {
                break;
            };
            wait_finished(retiring).await;
            clear_retiring(&self.retiring, &spec.id, generation);
        }
        if self.lifecycle.load(Ordering::Acquire) != lifecycle {
            return Err(AppError::Cancelled);
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (finished_tx, finished_rx) = watch::channel(false);
        let (ready_tx, ready_rx) = oneshot::channel();
        {
            let mut active = self.active.lock();
            if active.contains_key(&spec.id) {
                return Ok(());
            }
            if self.lifecycle.load(Ordering::Acquire) != lifecycle {
                return Err(AppError::Cancelled);
            }
            active.insert(
                spec.id.clone(),
                ActiveForward {
                    generation,
                    spec: spec.clone(),
                    shutdown: shutdown_tx,
                    finished: finished_rx,
                },
            );
        }

        let reporter = StatusReporter {
            app,
            runtime: self.runtime.clone(),
            next_sequence: self.next_sequence.clone(),
            id: spec.id.clone(),
            generation,
        };
        reporter.emit("starting", None, None);

        let active = self.active.clone();
        tokio::spawn(async move {
            run_forward(spec.clone(), prompts, shutdown_rx, ready_tx, reporter).await;
            remove_finished(&active, &spec.id, generation);
            let _ = finished_tx.send(true);
        });

        ready_rx.await.unwrap_or(Err(AppError::Cancelled))
    }

    pub async fn stop(&self, id: &str) -> bool {
        let entry = self.retire(id, |_| true);
        let Some(entry) = entry else {
            return false;
        };
        let _ = entry.shutdown.send(true);
        wait_finished(entry.finished).await;
        clear_retiring(&self.retiring, id, entry.generation);
        true
    }

    pub async fn stop_if_spec(&self, spec: &ForwardSpec) -> bool {
        let entry = self.retire(&spec.id, |entry| entry.spec == *spec);
        let Some(entry) = entry else {
            return false;
        };
        let _ = entry.shutdown.send(true);
        wait_finished(entry.finished).await;
        clear_retiring(&self.retiring, &spec.id, entry.generation);
        true
    }

    fn retire(
        &self,
        id: &str,
        predicate: impl FnOnce(&ActiveForward) -> bool,
    ) -> Option<ActiveForward> {
        let mut active = self.active.lock();
        if !active.get(id).is_some_and(predicate) {
            return None;
        }
        let entry = active.remove(id)?;
        self.retiring.lock().insert(
            id.to_string(),
            RetiringForward {
                generation: entry.generation,
                finished: entry.finished.clone(),
            },
        );
        Some(entry)
    }

    pub fn stop_all(&self) {
        self.lifecycle.fetch_add(1, Ordering::AcqRel);
        let entries = self.active.lock().drain().collect::<Vec<_>>();
        let mut retiring = self.retiring.lock();
        for (id, entry) in entries {
            let _ = entry.shutdown.send(true);
            retiring.insert(
                id,
                RetiringForward {
                    generation: entry.generation,
                    finished: entry.finished,
                },
            );
        }
    }

    pub fn forget(&self, id: &str) {
        self.runtime.lock().remove(id);
    }

    pub fn report_error(&self, app: &AppHandle, id: &str, error: &AppError) {
        self.reporter(app, id).emit("error", Some(error), None);
    }

    pub fn report_stopped(&self, app: &AppHandle, id: &str) {
        self.reporter(app, id).emit("stopped", None, None);
    }

    fn reporter(&self, app: &AppHandle, id: &str) -> StatusReporter {
        StatusReporter {
            app: app.clone(),
            runtime: self.runtime.clone(),
            next_sequence: self.next_sequence.clone(),
            id: id.to_string(),
            generation: self.next_generation.fetch_add(1, Ordering::Relaxed) + 1,
        }
    }
}

#[derive(Clone)]
struct StatusReporter {
    app: AppHandle,
    runtime: Arc<Mutex<HashMap<String, StatusEvent>>>,
    next_sequence: Arc<AtomicU64>,
    id: String,
    generation: u64,
}

impl StatusReporter {
    fn emit(&self, status: &str, error: Option<&AppError>, reconnect_attempt: Option<u32>) {
        let event = StatusEvent {
            forward_id: self.id.clone(),
            status: status.to_string(),
            message: error.map(ToString::to_string),
            code: error.map(|error| error.code().to_string()),
            reconnect_attempt,
            generation: self.generation,
            sequence: self.next_sequence.fetch_add(1, Ordering::Relaxed) + 1,
        };
        self.runtime.lock().insert(self.id.clone(), event.clone());
        let _ = self.app.emit(EVENT_STATUS, event);
    }
}

async fn wait_finished(mut finished: watch::Receiver<bool>) {
    if !*finished.borrow() {
        let _ = finished.wait_for(|value| *value).await;
    }
}

fn clear_retiring(retiring: &Mutex<HashMap<String, RetiringForward>>, id: &str, generation: u64) {
    let mut retiring = retiring.lock();
    if retiring
        .get(id)
        .is_some_and(|entry| entry.generation == generation)
    {
        retiring.remove(id);
    }
}

fn remove_finished(active: &Mutex<HashMap<String, ActiveForward>>, id: &str, generation: u64) {
    let mut active = active.lock();
    if active
        .get(id)
        .is_some_and(|entry| entry.generation == generation)
    {
        active.remove(id);
    }
}

async fn run_forward(
    spec: ForwardSpec,
    prompts: ConnectionPrompts,
    shutdown: watch::Receiver<bool>,
    ready: oneshot::Sender<AppResult<()>>,
    reporter: StatusReporter,
) {
    if spec.kind == kind::REMOTE {
        run_remote_forward(spec, prompts, shutdown, ready, reporter).await;
    } else {
        run_local_forward(spec, prompts, shutdown, ready, reporter).await;
    }
}

async fn run_local_forward(
    spec: ForwardSpec,
    prompts: ConnectionPrompts,
    mut shutdown: watch::Receiver<bool>,
    ready: oneshot::Sender<AppResult<()>>,
    reporter: StatusReporter,
) {
    let listener = tokio::select! {
        result = tokio::time::timeout(BIND_TIMEOUT, TcpListener::bind((spec.bind_host.as_str(), spec.bind_port))) => match result {
            Ok(Ok(listener)) => listener,
            Ok(Err(error)) => {
                let error = bind_error(&spec, error);
                reporter.emit("error", Some(&error), None);
                let _ = ready.send(Err(error));
                return;
            }
            Err(_) => {
                let error = AppError::Timeout(format!("binding {}:{} timed out", spec.bind_host, spec.bind_port));
                reporter.emit("error", Some(&error), None);
                let _ = ready.send(Err(error));
                return;
            }
        },
        _ = wait_for_shutdown(&mut shutdown) => {
            reporter.emit("stopped", None, None);
            let _ = ready.send(Err(AppError::Cancelled));
            return;
        }
    };

    let mut ready = Some(ready);
    let mut was_active = false;
    let mut reconnect_attempt = 0u32;
    loop {
        let connection =
            establish_while_listening(&listener, &reporter.app, &prompts, &spec, &mut shutdown)
                .await;
        let connection = match connection {
            Ok(connection) => connection,
            Err(AppError::Cancelled) => {
                reporter.emit("stopped", None, None);
                send_ready(&mut ready, Err(AppError::Cancelled));
                return;
            }
            Err(error) if !was_active => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_local_retry(&listener, retry_delay(reconnect_attempt), &mut shutdown).await
                {
                    reporter.emit("stopped", None, None);
                    return;
                }
                continue;
            }
        };

        was_active = true;
        reporter.emit("active", None, None);
        send_ready(&mut ready, Ok(()));
        match run_local_session(&listener, connection, &spec, &mut shutdown).await {
            SessionEnd::Stopped => {
                reporter.emit("stopped", None, None);
                return;
            }
            SessionEnd::Lost(error) => {
                reconnect_attempt = 1;
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_local_retry(&listener, retry_delay(reconnect_attempt), &mut shutdown).await
                {
                    reporter.emit("stopped", None, None);
                    return;
                }
            }
        }
    }
}

async fn establish_while_listening(
    listener: &TcpListener,
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    spec: &ForwardSpec,
    shutdown: &mut watch::Receiver<bool>,
) -> AppResult<Arc<SshConnection>> {
    let connection = establish(app, prompts, &spec.id, &spec.hops);
    tokio::pin!(connection);
    loop {
        tokio::select! {
            result = &mut connection => return result.map(Arc::new),
            accepted = listener.accept() => {
                if let Ok((stream, _)) = accepted {
                    let _ = stream.set_nodelay(true);
                }
            }
            _ = wait_for_shutdown(shutdown) => return Err(AppError::Cancelled),
        }
    }
}

async fn wait_local_retry(
    listener: &TcpListener,
    delay: Duration,
    shutdown: &mut watch::Receiver<bool>,
) -> bool {
    let sleep = tokio::time::sleep(delay);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return false,
            accepted = listener.accept() => {
                if let Ok((stream, _)) = accepted {
                    let _ = stream.set_nodelay(true);
                }
            }
            _ = wait_for_shutdown(shutdown) => return true,
        }
    }
}

enum SessionEnd {
    Stopped,
    Lost(AppError),
}

async fn run_local_session(
    listener: &TcpListener,
    connection: Arc<SshConnection>,
    spec: &ForwardSpec,
    shutdown: &mut watch::Receiver<bool>,
) -> SessionEnd {
    let mut connections = JoinSet::new();
    let mut connection_check = tokio::time::interval_at(
        Instant::now() + CONNECTION_CHECK_INTERVAL,
        CONNECTION_CHECK_INTERVAL,
    );
    connection_check.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let result = loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, peer)) if connections.len() < MAX_FORWARD_CONNECTIONS => {
                    let _ = stream.set_nodelay(true);
                    let connection = connection.clone();
                    let spec = spec.clone();
                    connections.spawn(async move { serve_local_connection(connection, spec, stream, peer).await });
                }
                Ok(_) => {}
                Err(error) => break SessionEnd::Lost(AppError::Io(error)),
            },
            _ = wait_for_shutdown(shutdown) => break SessionEnd::Stopped,
            _ = connection_check.tick() => {
                if connection.handle.is_closed() {
                    break SessionEnd::Lost(AppError::Network("SSH connection for port forward was closed".into()));
                }
            }
            _ = connections.join_next(), if !connections.is_empty() => {}
        }
    };
    connections.shutdown().await;
    result
}

async fn serve_local_connection(
    connection: Arc<SshConnection>,
    spec: ForwardSpec,
    mut stream: TcpStream,
    peer: SocketAddr,
) -> AppResult<()> {
    let dynamic = spec.kind == kind::DYNAMIC;
    let (target_host, target_port) = if dynamic {
        tokio::time::timeout(SOCKS_HANDSHAKE_TIMEOUT, socks5_request(&mut stream))
            .await
            .map_err(|_| AppError::Timeout("SOCKS handshake timed out".into()))??
    } else {
        (
            spec.target_host
                .clone()
                .ok_or_else(|| AppError::Invalid("missing forward target host".into()))?,
            spec.target_port
                .ok_or_else(|| AppError::Invalid("missing forward target port".into()))?,
        )
    };
    let opened = tokio::time::timeout(
        CHANNEL_OPEN_TIMEOUT,
        connection.handle.channel_open_direct_tcpip(
            target_host,
            target_port as u32,
            peer.ip().to_string(),
            peer.port() as u32,
        ),
    )
    .await;
    let channel = match opened {
        Ok(Ok(channel)) => channel,
        Ok(Err(error)) => {
            if dynamic {
                let _ = socks5_reply(&mut stream, 0x01).await;
            }
            return Err(AppError::Ssh(error));
        }
        Err(_) => {
            if dynamic {
                let _ = socks5_reply(&mut stream, 0x06).await;
            }
            return Err(AppError::Timeout(
                "opening the forwarded SSH channel timed out".into(),
            ));
        }
    };
    if dynamic {
        socks5_reply(&mut stream, 0x00).await?;
    }
    let mut channel = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut channel).await?;
    Ok(())
}

async fn run_remote_forward(
    spec: ForwardSpec,
    prompts: ConnectionPrompts,
    mut shutdown: watch::Receiver<bool>,
    ready: oneshot::Sender<AppResult<()>>,
    reporter: StatusReporter,
) {
    let Some(target_host) = spec.target_host.clone() else {
        let error = AppError::Invalid("missing remote forward target host".into());
        reporter.emit("error", Some(&error), None);
        let _ = ready.send(Err(error));
        return;
    };
    let Some(target_port) = spec.target_port else {
        let error = AppError::Invalid("missing remote forward target port".into());
        reporter.emit("error", Some(&error), None);
        let _ = ready.send(Err(error));
        return;
    };

    let mut ready = Some(ready);
    let mut was_active = false;
    let mut reconnect_attempt = 0u32;
    loop {
        let (forwarded_tx, forwarded_rx) = mpsc::channel(MAX_FORWARD_CONNECTIONS);
        let connection = tokio::select! {
            result = establish_with_forwarded_tcpip(&reporter.app, &prompts, &spec.id, &spec.hops, Some(forwarded_tx)) => result.map(Arc::new),
            _ = wait_for_shutdown(&mut shutdown) => Err(AppError::Cancelled),
        };
        let connection = match connection {
            Ok(connection) => connection,
            Err(AppError::Cancelled) => {
                reporter.emit("stopped", None, None);
                send_ready(&mut ready, Err(AppError::Cancelled));
                return;
            }
            Err(error) if !was_active => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(retry_delay(reconnect_attempt), &mut shutdown).await {
                    reporter.emit("stopped", None, None);
                    return;
                }
                continue;
            }
        };

        let registration = tokio::select! {
            result = tokio::time::timeout(
                CHANNEL_OPEN_TIMEOUT,
                connection.handle.tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32),
            ) => match result {
                Ok(Ok(_)) => Ok(()),
                Ok(Err(russh::Error::RequestDenied)) => Err(AppError::Other(format!(
                    "server rejected remote bind {}:{}; try 127.0.0.1 with an unprivileged unused port, or verify AllowTcpForwarding, PermitListen, and GatewayPorts",
                    spec.bind_host, spec.bind_port
                ))),
                Ok(Err(error)) => Err(AppError::Ssh(error)),
                Err(_) => Err(AppError::Timeout(format!("requesting remote bind {}:{} timed out", spec.bind_host, spec.bind_port))),
            },
            _ = wait_for_shutdown(&mut shutdown) => Err(AppError::Cancelled),
        };
        match registration {
            Ok(()) => {}
            Err(AppError::Cancelled) => {
                reporter.emit("stopped", None, None);
                send_ready(&mut ready, Err(AppError::Cancelled));
                return;
            }
            Err(error) if !was_active => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(retry_delay(reconnect_attempt), &mut shutdown).await {
                    reporter.emit("stopped", None, None);
                    return;
                }
                continue;
            }
        }

        was_active = true;
        reporter.emit("active", None, None);
        send_ready(&mut ready, Ok(()));
        let end = run_remote_session(
            connection.clone(),
            forwarded_rx,
            &spec,
            &target_host,
            target_port,
            &mut shutdown,
        )
        .await;
        let _ = tokio::time::timeout(
            CHANNEL_OPEN_TIMEOUT,
            connection
                .handle
                .cancel_tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32),
        )
        .await;
        match end {
            SessionEnd::Stopped => {
                reporter.emit("stopped", None, None);
                return;
            }
            SessionEnd::Lost(error) => {
                reconnect_attempt = 1;
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(retry_delay(reconnect_attempt), &mut shutdown).await {
                    reporter.emit("stopped", None, None);
                    return;
                }
            }
        }
    }
}

async fn run_remote_session(
    connection: Arc<SshConnection>,
    mut forwarded: mpsc::Receiver<ForwardedTcpIp>,
    spec: &ForwardSpec,
    target_host: &str,
    target_port: u16,
    shutdown: &mut watch::Receiver<bool>,
) -> SessionEnd {
    let mut connections = JoinSet::new();
    let mut connection_check = tokio::time::interval_at(
        Instant::now() + CONNECTION_CHECK_INTERVAL,
        CONNECTION_CHECK_INTERVAL,
    );
    connection_check.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let result = loop {
        tokio::select! {
            incoming = forwarded.recv() => {
                let Some(incoming) = incoming else {
                    break SessionEnd::Lost(AppError::Network("SSH connection for remote port forward was closed".into()));
                };
                if incoming.connected_port != spec.bind_port as u32 || connections.len() >= MAX_FORWARD_CONNECTIONS {
                    continue;
                }
                let _ = (&incoming.connected_address, &incoming.originator_address, incoming.originator_port);
                let host = target_host.to_string();
                connections.spawn(async move {
                    let mut local = connect_target(&host, target_port).await?;
                    let mut remote = incoming.channel.into_stream();
                    tokio::io::copy_bidirectional(&mut local, &mut remote).await?;
                    Ok::<(), AppError>(())
                });
            }
            _ = wait_for_shutdown(shutdown) => break SessionEnd::Stopped,
            _ = connection_check.tick() => {
                if connection.handle.is_closed() {
                    break SessionEnd::Lost(AppError::Network("SSH connection for remote port forward was closed".into()));
                }
            }
            _ = connections.join_next(), if !connections.is_empty() => {}
        }
    };
    connections.shutdown().await;
    result
}

async fn connect_target(host: &str, port: u16) -> AppResult<TcpStream> {
    let connect = async {
        let addresses = tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| AppError::Dns(format!("could not resolve {host}: {error}")))?
            .collect::<Vec<_>>();
        if addresses.is_empty() {
            return Err(AppError::Dns(format!("no address resolved for {host}")));
        }
        let mut last_error = None;
        for address in addresses {
            match TcpStream::connect(address).await {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    return Ok(stream);
                }
                Err(error) => last_error = Some(error),
            }
        }
        Err(AppError::Io(last_error.unwrap_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotConnected, "target is unreachable")
        })))
    };
    tokio::time::timeout(CHANNEL_OPEN_TIMEOUT, connect)
        .await
        .map_err(|_| AppError::Timeout(format!("connecting to {host}:{port} timed out")))?
}

async fn wait_retry(delay: Duration, shutdown: &mut watch::Receiver<bool>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(delay) => false,
        _ = wait_for_shutdown(shutdown) => true,
    }
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    loop {
        if shutdown.changed().await.is_err() || *shutdown.borrow() {
            return;
        }
    }
}

fn retry_delay(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(5);
    Duration::from_secs(1u64 << exponent).min(RECONNECT_DELAY_MAX)
}

fn send_ready(ready: &mut Option<oneshot::Sender<AppResult<()>>>, result: AppResult<()>) {
    if let Some(ready) = ready.take() {
        let _ = ready.send(result);
    }
}

fn bind_error(spec: &ForwardSpec, error: std::io::Error) -> AppError {
    if spec.bind_port < 1024 {
        AppError::Other(format!(
            "could not listen on {}:{} ({error}). Choose a port above 1023 or grant permission to bind privileged ports",
            spec.bind_host, spec.bind_port
        ))
    } else {
        AppError::Other(format!(
            "could not listen on {}:{} ({error})",
            spec.bind_host, spec.bind_port
        ))
    }
}

async fn socks5_reply<S>(stream: &mut S, status: u8) -> AppResult<()>
where
    S: AsyncWrite + Unpin,
{
    stream
        .write_all(&[0x05, status, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
    Ok(())
}

async fn socks5_request<S>(stream: &mut S) -> AppResult<(String, u16)>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut greeting = [0u8; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Err(AppError::Invalid("unsupported SOCKS version".into()));
    }
    if greeting[1] == 0 {
        stream.write_all(&[0x05, 0xff]).await?;
        return Err(AppError::Invalid("no SOCKS authentication methods".into()));
    }
    let mut methods = vec![0u8; greeting[1] as usize];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await?;
        return Err(AppError::Invalid(
            "SOCKS client does not support no-authentication mode".into(),
        ));
    }
    stream.write_all(&[0x05, 0x00]).await?;

    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    if request[0] != 0x05 || request[2] != 0x00 {
        socks5_reply(stream, 0x01).await?;
        return Err(AppError::Invalid("invalid SOCKS request header".into()));
    }
    if request[1] != 0x01 {
        socks5_reply(stream, 0x07).await?;
        return Err(AppError::Invalid("only SOCKS CONNECT is supported".into()));
    }

    let host = match request[3] {
        0x01 => {
            let mut address = [0u8; 4];
            stream.read_exact(&mut address).await?;
            std::net::Ipv4Addr::from(address).to_string()
        }
        0x03 => {
            let length = stream.read_u8().await? as usize;
            if length == 0 {
                socks5_reply(stream, 0x08).await?;
                return Err(AppError::Invalid("empty SOCKS domain name".into()));
            }
            let mut name = vec![0u8; length];
            stream.read_exact(&mut name).await?;
            match String::from_utf8(name) {
                Ok(name) => name,
                Err(_) => {
                    socks5_reply(stream, 0x08).await?;
                    return Err(AppError::Invalid(
                        "SOCKS domain name is not valid UTF-8".into(),
                    ));
                }
            }
        }
        0x04 => {
            let mut address = [0u8; 16];
            stream.read_exact(&mut address).await?;
            std::net::Ipv6Addr::from(address).to_string()
        }
        _ => {
            socks5_reply(stream, 0x08).await?;
            return Err(AppError::Invalid("unsupported SOCKS address type".into()));
        }
    };
    let port = stream.read_u16().await?;
    if port == 0 {
        socks5_reply(stream, 0x01).await?;
        return Err(AppError::Invalid("SOCKS target port cannot be zero".into()));
    }
    Ok((host, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forward_spec(target_port: u16) -> ForwardSpec {
        ForwardSpec {
            id: "forward".into(),
            kind: "local".into(),
            bind_host: "127.0.0.1".into(),
            bind_port: 8080,
            target_host: Some("localhost".into()),
            target_port: Some(target_port),
            hops: Vec::new(),
        }
    }

    #[tokio::test]
    async fn socks5_parses_domain_connect_without_premature_success() {
        let (mut client, mut server) = tokio::io::duplex(256);
        let client_task = tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut method_reply = [0u8; 2];
            client.read_exact(&mut method_reply).await.unwrap();
            assert_eq!(method_reply, [0x05, 0x00]);
            let host = b"example.com";
            let mut request = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
            request.extend_from_slice(host);
            request.extend_from_slice(&8080u16.to_be_bytes());
            client.write_all(&request).await.unwrap();
            let mut reply = [0u8; 10];
            assert!(
                tokio::time::timeout(Duration::from_millis(20), client.read_exact(&mut reply))
                    .await
                    .is_err()
            );
        });
        assert_eq!(
            socks5_request(&mut server).await.unwrap(),
            ("example.com".into(), 8080)
        );
        client_task.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_rejects_unoffered_authentication_method() {
        let (mut client, mut server) = tokio::io::duplex(64);
        let client_task = tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x02]).await.unwrap();
            let mut reply = [0u8; 2];
            client.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply, [0x05, 0xff]);
        });
        assert!(socks5_request(&mut server).await.is_err());
        client_task.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_rejects_unsupported_commands_and_zero_ports() {
        for request in [
            [0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0, 80],
            [0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, 0, 0],
        ] {
            let (mut client, mut server) = tokio::io::duplex(64);
            let client_task = tokio::spawn(async move {
                client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
                let mut method_reply = [0u8; 2];
                client.read_exact(&mut method_reply).await.unwrap();
                client.write_all(&request).await.unwrap();
                let mut reply = [0u8; 10];
                client.read_exact(&mut reply).await.unwrap();
                assert_ne!(reply[1], 0x00);
            });
            assert!(socks5_request(&mut server).await.is_err());
            client_task.await.unwrap();
        }
    }

    #[test]
    fn reconnect_delay_uses_bounded_exponential_backoff() {
        assert_eq!(retry_delay(1), Duration::from_secs(1));
        assert_eq!(retry_delay(2), Duration::from_secs(2));
        assert_eq!(retry_delay(6), Duration::from_secs(30));
        assert_eq!(retry_delay(30), Duration::from_secs(30));
    }

    #[test]
    fn old_generation_cannot_remove_replacement() {
        let active = Mutex::new(HashMap::new());
        let (shutdown, _) = watch::channel(false);
        let (_, finished) = watch::channel(false);
        active.lock().insert(
            "forward".into(),
            ActiveForward {
                generation: 2,
                spec: forward_spec(80),
                shutdown,
                finished,
            },
        );

        remove_finished(&active, "forward", 1);
        assert_eq!(active.lock().get("forward").unwrap().generation, 2);
        remove_finished(&active, "forward", 2);
        assert!(!active.lock().contains_key("forward"));
    }

    #[test]
    fn stop_all_cancels_active_forwards_and_invalidates_starts() {
        let manager = ForwardManager::new();
        let lifecycle = manager.lifecycle.load(Ordering::Acquire);
        let (shutdown, shutdown_rx) = watch::channel(false);
        let (_, finished) = watch::channel(false);
        manager.active.lock().insert(
            "forward".into(),
            ActiveForward {
                generation: 1,
                spec: forward_spec(80),
                shutdown,
                finished,
            },
        );

        manager.stop_all();

        assert!(manager.active.lock().is_empty());
        assert!(*shutdown_rx.borrow());
        assert_ne!(manager.lifecycle.load(Ordering::Acquire), lifecycle);
    }

    #[tokio::test]
    async fn conditional_stop_leaves_replacement_running() {
        let manager = ForwardManager::new();
        let current = forward_spec(80);
        let (shutdown, _) = watch::channel(false);
        let (_, finished) = watch::channel(false);
        manager.active.lock().insert(
            current.id.clone(),
            ActiveForward {
                generation: 1,
                spec: current.clone(),
                shutdown,
                finished,
            },
        );

        assert!(!manager.stop_if_spec(&forward_spec(81)).await);
        assert!(manager.active_specs().iter().any(|spec| spec == &current));
    }
}
