use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;
use tokio::time::{Instant, MissedTickBehavior};

use super::connect::{establish_with_forwarded_tcpip, SshConnection};
use super::handler::{ForwardedTcpIp, ForwardedTcpIpRoute};
use super::{ConnectionPrompts, Hop};
use crate::error::{AppError, AppResult};

pub const EVENT_STATUS: &str = "forward://status";

const BIND_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const REMOTE_CANCEL_TIMEOUT: Duration = Duration::from_secs(2);
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
    pub connection_failures: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connection_error: Option<String>,
}

type ReadyResult = Option<Result<(), Arc<AppError>>>;

pub struct PendingForward(watch::Receiver<ReadyResult>);

impl PendingForward {
    pub async fn wait(mut self) -> AppResult<()> {
        self.0
            .wait_for(Option::is_some)
            .await
            .map_err(|_| AppError::Cancelled)?
            .as_ref()
            .unwrap()
            .clone()
            .map_err(AppError::Shared)
    }
}

struct ForwardReady(watch::Sender<ReadyResult>);

impl ForwardReady {
    fn send(self, result: AppResult<()>) {
        let _ = self.0.send(Some(result.map_err(Arc::new)));
    }
}

struct ActiveForward {
    generation: u64,
    spec: ForwardSpec,
    ready: watch::Receiver<ReadyResult>,
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
    operations: Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
    pub configuration: tokio::sync::RwLock<()>,
    auto_start_suppressed: Mutex<HashSet<String>>,
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

    pub async fn operation(&self, id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let operation = {
            let mut operations = self.operations.lock();
            operations.retain(|_, operation| operation.strong_count() > 0);
            match operations.get(id).and_then(Weak::upgrade) {
                Some(operation) => operation,
                None => {
                    let operation = Arc::new(tokio::sync::Mutex::new(()));
                    operations.insert(id.to_string(), Arc::downgrade(&operation));
                    operation
                }
            }
        };
        operation.lock_owned().await
    }

    pub fn suppress_auto_start(&self, id: &str) {
        self.auto_start_suppressed.lock().insert(id.to_string());
    }

    pub fn allows_auto_start(&self, id: &str) -> bool {
        !self.auto_start_suppressed.lock().contains(id)
    }

    pub fn lifecycle(&self) -> u64 {
        self.lifecycle.load(Ordering::Acquire)
    }

    pub async fn prepare_start(
        &self,
        app: AppHandle,
        prompts: ConnectionPrompts,
        spec: ForwardSpec,
        lifecycle: u64,
    ) -> AppResult<PendingForward> {
        if self.lifecycle() != lifecycle {
            return Err(AppError::Cancelled);
        }
        loop {
            if let Some(entry) = self.active.lock().get(&spec.id) {
                if entry.spec != spec {
                    return Err(AppError::Conflict("port forward is running with different settings; stop it before starting it again".into()));
                }
                return Ok(PendingForward(entry.ready.clone()));
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
        let (ready_tx, ready_rx) = watch::channel(None);
        {
            let mut active = self.active.lock();
            if let Some(entry) = active.get(&spec.id) {
                if entry.spec != spec {
                    return Err(AppError::Conflict("port forward is running with different settings; stop it before starting it again".into()));
                }
                return Ok(PendingForward(entry.ready.clone()));
            }
            if self.lifecycle.load(Ordering::Acquire) != lifecycle {
                return Err(AppError::Cancelled);
            }
            active.insert(
                spec.id.clone(),
                ActiveForward {
                    generation,
                    spec: spec.clone(),
                    ready: ready_rx.clone(),
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

        let completion = ForwardTaskCompletion {
            active: self.active.clone(),
            id: spec.id.clone(),
            generation,
            finished: finished_tx,
            reporter: reporter.clone(),
            completed: false,
        };
        tokio::spawn(async move {
            let mut completion = completion;
            run_forward(
                spec.clone(),
                prompts,
                shutdown_rx,
                ForwardReady(ready_tx),
                reporter,
            )
            .await;
            completion.completed = true;
        });

        Ok(PendingForward(ready_rx))
    }

    pub async fn stop(&self, id: &str) -> bool {
        let entry = self.retire(id, |_| true);
        let Some(entry) = entry else {
            let retiring = self
                .retiring
                .lock()
                .get(id)
                .map(|entry| (entry.generation, entry.finished.clone()));
            if let Some((generation, finished)) = retiring {
                wait_finished(finished).await;
                clear_retiring(&self.retiring, id, generation);
                return true;
            }
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
        let mut active = self.active.lock();
        self.lifecycle.fetch_add(1, Ordering::AcqRel);
        let mut retiring = self.retiring.lock();
        let entries = active.drain().collect::<Vec<_>>();
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
        self.auto_start_suppressed.lock().remove(id);
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

struct ForwardTaskCompletion {
    active: Arc<Mutex<HashMap<String, ActiveForward>>>,
    id: String,
    generation: u64,
    finished: watch::Sender<bool>,
    reporter: StatusReporter,
    completed: bool,
}

impl Drop for ForwardTaskCompletion {
    fn drop(&mut self) {
        if !self.completed {
            self.reporter.emit(
                "error",
                Some(&AppError::Other(
                    "port forward task ended unexpectedly; start the port forward again".into(),
                )),
                None,
            );
        }
        remove_finished(&self.active, &self.id, self.generation);
        let _ = self.finished.send(true);
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
            connection_failures: 0,
            last_connection_error: None,
        };
        let mut runtime = self.runtime.lock();
        if !store_event(&mut runtime, &event) {
            return;
        }
        let event = runtime.get(&self.id).unwrap().clone();
        drop(runtime);
        let _ = self.app.emit(EVENT_STATUS, event);
    }
}

fn store_event(runtime: &mut HashMap<String, StatusEvent>, event: &StatusEvent) -> bool {
    if runtime.get(&event.forward_id).is_some_and(|current| {
        current.generation > event.generation
            || (current.generation == event.generation && current.sequence >= event.sequence)
    }) {
        return false;
    }
    let mut event = event.clone();
    if let Some(current) = runtime
        .get(&event.forward_id)
        .filter(|current| current.generation == event.generation)
    {
        event.connection_failures = current.connection_failures;
        event.last_connection_error = current.last_connection_error.clone();
    }
    runtime.insert(event.forward_id.clone(), event);
    true
}

#[derive(Default)]
struct ConnectionDiagnostics {
    failures: u64,
    last_error: Option<String>,
}

impl ConnectionDiagnostics {
    fn observe(&mut self, result: Option<Result<AppResult<()>, tokio::task::JoinError>>) {
        let error = match result {
            Some(Ok(Err(error))) => error.to_string(),
            Some(Err(error)) => format!("port forward connection task failed: {error}"),
            _ => return,
        };
        self.record(error);
    }

    fn record(&mut self, error: String) {
        self.failures = self.failures.saturating_add(1);
        self.last_error = Some(error);
    }

    fn flush(&mut self, reporter: &StatusReporter) {
        let Some(error) = self.last_error.take() else {
            return;
        };
        let mut runtime = reporter.runtime.lock();
        let Some(event) = runtime
            .get_mut(&reporter.id)
            .filter(|event| event.generation == reporter.generation)
        else {
            return;
        };
        event.connection_failures = event.connection_failures.saturating_add(self.failures);
        self.failures = 0;
        event.last_connection_error = Some(error);
        event.sequence = reporter.next_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let event = event.clone();
        drop(runtime);
        let _ = reporter.app.emit(EVENT_STATUS, event);
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
    ready: ForwardReady,
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
    ready: ForwardReady,
    reporter: StatusReporter,
) {
    let listener = tokio::select! {
        result = tokio::time::timeout(BIND_TIMEOUT, TcpListener::bind((spec.bind_host.as_str(), spec.bind_port))) => match result {
            Ok(Ok(listener)) => listener,
            Ok(Err(error)) => {
                let error = bind_error(&spec, error);
                reporter.emit("error", Some(&error), None);
                ready.send(Err(error));
                return;
            }
            Err(_) => {
                let error = AppError::Timeout(format!("binding {}:{} timed out", spec.bind_host, spec.bind_port));
                reporter.emit("error", Some(&error), None);
                ready.send(Err(error));
                return;
            }
        },
        _ = wait_for_shutdown(&mut shutdown) => {
            reporter.emit("stopped", None, None);
            ready.send(Err(AppError::Cancelled));
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
            Err(error) if !was_active || !retryable_connection_error(&error) => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_local_retry(
                    &listener,
                    jittered_retry_delay(reconnect_attempt),
                    &mut shutdown,
                )
                .await
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
        let session_started = Instant::now();
        match run_local_session(&listener, connection, &spec, &mut shutdown, &reporter).await {
            SessionEnd::Stopped => {
                reporter.emit("stopped", None, None);
                return;
            }
            SessionEnd::Lost(error) => {
                reconnect_attempt =
                    next_reconnect_attempt(reconnect_attempt, session_started.elapsed());
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_local_retry(
                    &listener,
                    jittered_retry_delay(reconnect_attempt),
                    &mut shutdown,
                )
                .await
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
    let connection = establish_with_forwarded_tcpip(
        app,
        prompts,
        &spec.id,
        &spec.hops,
        None,
        Some(shutdown.clone()),
    );
    tokio::pin!(connection);
    loop {
        tokio::select! {
            biased;
            _ = wait_for_shutdown(shutdown) => return Err(AppError::Cancelled),
            result = &mut connection => return result.map(Arc::new),
            accepted = listener.accept() => {
                if let Ok((stream, _)) = accepted {
                    let _ = stream.set_nodelay(true);
                }
            }
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
    reporter: &StatusReporter,
) -> SessionEnd {
    let mut connections = JoinSet::new();
    let mut diagnostics = ConnectionDiagnostics::default();
    let mut connection_check = tokio::time::interval_at(
        Instant::now() + CONNECTION_CHECK_INTERVAL,
        CONNECTION_CHECK_INTERVAL,
    );
    connection_check.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let result = loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, peer)) => {
                    while let Some(result) = connections.try_join_next() {
                        diagnostics.observe(Some(result));
                    }
                    if connections.len() >= MAX_FORWARD_CONNECTIONS {
                        diagnostics.record("port forward connection limit reached; close an existing connection and try again".into());
                        continue;
                    }
                    let _ = stream.set_nodelay(true);
                    let connection = connection.clone();
                    let spec = spec.clone();
                    connections.spawn(async move { serve_local_connection(&connection.handle, spec, stream, peer).await });
                }
                Err(error) => break SessionEnd::Lost(AppError::Io(error)),
            },
            _ = wait_for_shutdown(shutdown) => break SessionEnd::Stopped,
            _ = connection_check.tick() => {
                diagnostics.flush(reporter);
                if connection.handle.is_closed() {
                    break SessionEnd::Lost(AppError::Network("SSH connection for port forward was closed".into()));
                }
            }
            result = connections.join_next(), if !connections.is_empty() => {
                diagnostics.observe(result);
            }
        }
    };
    diagnostics.flush(reporter);
    connections.shutdown().await;
    result
}

async fn serve_local_connection<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
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
        handle.channel_open_direct_tcpip(
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
                let _ = socks5_reply(&mut stream, 0x01).await;
            }
            return Err(AppError::Timeout(
                "opening the forwarded SSH channel timed out".into(),
            ));
        }
    };
    let mut channel = channel.into_stream();
    if dynamic {
        socks5_reply(&mut stream, 0x00).await?;
    }
    tokio::io::copy_bidirectional(&mut stream, &mut channel).await?;
    Ok(())
}

async fn run_remote_forward(
    spec: ForwardSpec,
    prompts: ConnectionPrompts,
    mut shutdown: watch::Receiver<bool>,
    ready: ForwardReady,
    reporter: StatusReporter,
) {
    let Some(target_host) = spec.target_host.clone() else {
        let error = AppError::Invalid("missing remote forward target host".into());
        reporter.emit("error", Some(&error), None);
        ready.send(Err(error));
        return;
    };
    let Some(target_port) = spec.target_port else {
        let error = AppError::Invalid("missing remote forward target port".into());
        reporter.emit("error", Some(&error), None);
        ready.send(Err(error));
        return;
    };

    let mut ready = Some(ready);
    let mut was_active = false;
    let mut reconnect_attempt = 0u32;
    loop {
        let (forwarded_tx, forwarded_rx) = mpsc::channel(MAX_FORWARD_CONNECTIONS);
        let requested = Arc::new(AtomicBool::new(false));
        let route = ForwardedTcpIpRoute {
            port: spec.bind_port,
            sender: forwarded_tx,
            requested: requested.clone(),
            capacity: Arc::new(tokio::sync::Semaphore::new(MAX_FORWARD_CONNECTIONS)),
        };
        let connection_shutdown = shutdown.clone();
        let connection = tokio::select! {
            biased;
            _ = wait_for_shutdown(&mut shutdown) => Err(AppError::Cancelled),
            result = establish_with_forwarded_tcpip(&reporter.app, &prompts, &spec.id, &spec.hops, Some(route), Some(connection_shutdown)) => result.map(Arc::new),
        };
        let connection = match connection {
            Ok(connection) => connection,
            Err(AppError::Cancelled) => {
                reporter.emit("stopped", None, None);
                send_ready(&mut ready, Err(AppError::Cancelled));
                return;
            }
            Err(error) if !was_active || !retryable_connection_error(&error) => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(jittered_retry_delay(reconnect_attempt), &mut shutdown).await {
                    reporter.emit("stopped", None, None);
                    return;
                }
                continue;
            }
        };

        requested.store(true, Ordering::Release);
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
        if registration.is_err() {
            requested.store(false, Ordering::Release);
        }
        match registration {
            Ok(()) => {}
            Err(AppError::Cancelled) => {
                reporter.emit("stopped", None, None);
                send_ready(&mut ready, Err(AppError::Cancelled));
                return;
            }
            Err(error) if !was_active || !retryable_connection_error(&error) => {
                reporter.emit("error", Some(&error), None);
                send_ready(&mut ready, Err(error));
                return;
            }
            Err(error) => {
                drop(connection);
                drop(forwarded_rx);
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(jittered_retry_delay(reconnect_attempt), &mut shutdown).await {
                    reporter.emit("stopped", None, None);
                    return;
                }
                continue;
            }
        }

        was_active = true;
        reporter.emit("active", None, None);
        send_ready(&mut ready, Ok(()));
        let session_started = Instant::now();
        let end = run_remote_session(
            connection.clone(),
            forwarded_rx,
            &target_host,
            target_port,
            &mut shutdown,
            &reporter,
        )
        .await;
        requested.store(false, Ordering::Release);
        let _ = tokio::time::timeout(
            REMOTE_CANCEL_TIMEOUT,
            connection
                .handle
                .cancel_tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32),
        )
        .await;
        drop(connection);
        match end {
            SessionEnd::Stopped => {
                reporter.emit("stopped", None, None);
                return;
            }
            SessionEnd::Lost(error) => {
                reconnect_attempt =
                    next_reconnect_attempt(reconnect_attempt, session_started.elapsed());
                reporter.emit("reconnecting", Some(&error), Some(reconnect_attempt));
                if wait_retry(jittered_retry_delay(reconnect_attempt), &mut shutdown).await {
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
    target_host: &str,
    target_port: u16,
    shutdown: &mut watch::Receiver<bool>,
    reporter: &StatusReporter,
) -> SessionEnd {
    let mut connections = JoinSet::new();
    let mut diagnostics = ConnectionDiagnostics::default();
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
                let host = target_host.to_string();
                connections.spawn(async move {
                    serve_remote_connection(incoming, &host, target_port).await
                });
            }
            _ = wait_for_shutdown(shutdown) => break SessionEnd::Stopped,
            _ = connection_check.tick() => {
                diagnostics.flush(reporter);
                if connection.handle.is_closed() {
                    break SessionEnd::Lost(AppError::Network("SSH connection for remote port forward was closed".into()));
                }
            }
            result = connections.join_next(), if !connections.is_empty() => {
                diagnostics.observe(result);
            }
        }
    };
    diagnostics.flush(reporter);
    connections.shutdown().await;
    result
}

async fn serve_remote_connection(incoming: ForwardedTcpIp, host: &str, port: u16) -> AppResult<()> {
    let ForwardedTcpIp {
        stream,
        permit: _permit,
    } = incoming;
    relay_remote_stream(stream, host, port).await
}

async fn relay_remote_stream<S>(mut remote: S, host: &str, port: u16) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut local = connect_target(host, port).await?;
    tokio::io::copy_bidirectional(&mut local, &mut remote).await?;
    Ok(())
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

pub(super) async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    loop {
        if shutdown.changed().await.is_err() || *shutdown.borrow() {
            return;
        }
    }
}

fn retryable_connection_error(error: &AppError) -> bool {
    matches!(error.code(), "network" | "dns" | "timeout" | "io")
}

fn next_reconnect_attempt(previous: u32, active_for: Duration) -> u32 {
    if active_for >= RECONNECT_DELAY_MAX {
        1
    } else {
        previous.saturating_add(1)
    }
}

fn jittered_retry_delay(attempt: u32) -> Duration {
    retry_delay(attempt)
        .mul_f64(rand::random_range(0.8..=1.2))
        .min(RECONNECT_DELAY_MAX)
}

fn retry_delay(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(5);
    Duration::from_secs(1u64 << exponent).min(RECONNECT_DELAY_MAX)
}

fn send_ready(ready: &mut Option<ForwardReady>, result: AppResult<()>) {
    if let Some(ready) = ready.take() {
        ready.send(result);
    }
}

fn bind_error(spec: &ForwardSpec, error: std::io::Error) -> AppError {
    if spec.bind_port < 1024 && error.kind() == std::io::ErrorKind::PermissionDenied {
        AppError::Other(format!(
            "could not listen on {}:{} ({error}). Choose a port above 1023 or grant permission to bind privileged ports",
            spec.bind_host, spec.bind_port
        ))
    } else if error.kind() == std::io::ErrorKind::AddrInUse {
        AppError::Other(format!(
            "could not listen on {}:{} because the address is in use; stop the other listener or choose a different address or port",
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
mod tests;
