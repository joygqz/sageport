use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinSet;
use tokio::time::{Instant, MissedTickBehavior};

use super::connect::{establish, establish_with_forwarded_tcpip, SshConnection};
use super::exec::exec_capture_limited;
use super::{ConnectionPrompts, Hop};
use crate::error::{AppError, AppResult};

pub const EVENT_STATUS: &str = "forward://status";

const BIND_TIMEOUT: Duration = Duration::from_secs(10);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const SOCKS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECTION_CHECK_INTERVAL: Duration = Duration::from_secs(1);
const REMOTE_LISTENER_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_FORWARD_CONNECTIONS: usize = 256;
const MAX_REMOTE_LISTENER_OUTPUT_BYTES: usize = 16 * 1024;

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
    pub generation: u64,
    pub sequence: u64,
    pub public_bind_restricted: bool,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct StartReservation {
    lifecycle: u64,
    token: u64,
}

struct StartGuard {
    id: String,
    reservation: StartReservation,
    preparing: Arc<Mutex<HashMap<String, StartReservation>>>,
}

impl Drop for StartGuard {
    fn drop(&mut self) {
        let mut preparing = self.preparing.lock();
        if preparing
            .get(&self.id)
            .is_some_and(|reservation| *reservation == self.reservation)
        {
            preparing.remove(&self.id);
        }
    }
}

#[derive(Default)]
pub struct ForwardManager {
    active: Arc<Mutex<HashMap<String, ActiveForward>>>,
    retiring: Arc<Mutex<HashMap<String, RetiringForward>>>,
    preparing: Arc<Mutex<HashMap<String, StartReservation>>>,
    runtime: Arc<Mutex<HashMap<String, StatusEvent>>>,
    next_generation: Arc<AtomicU64>,
    next_sequence: Arc<AtomicU64>,
    next_reservation: Arc<AtomicU64>,
    lifecycle: Arc<Mutex<u64>>,
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

    pub async fn stop(&self, id: &str) -> bool {
        let was_preparing = self.preparing.lock().remove(id).is_some();
        let entry = {
            let mut active = self.active.lock();
            let entry = active.remove(id);
            if let Some(entry) = entry.as_ref() {
                self.retiring.lock().insert(
                    id.to_string(),
                    RetiringForward {
                        generation: entry.generation,
                        finished: entry.finished.clone(),
                    },
                );
            }
            entry
        };
        let Some(entry) = entry else {
            return was_preparing;
        };
        let _ = entry.shutdown.send(true);
        wait_finished(entry.finished).await;
        clear_retiring(&self.retiring, id, entry.generation);
        true
    }

    pub async fn stop_if_spec(&self, spec: &ForwardSpec) -> bool {
        let entry = {
            let mut active = self.active.lock();
            let entry = if active
                .get(&spec.id)
                .is_some_and(|entry| entry.spec == *spec)
            {
                active.remove(&spec.id)
            } else {
                None
            };
            if let Some(entry) = entry.as_ref() {
                self.preparing.lock().remove(&spec.id);
                self.retiring.lock().insert(
                    spec.id.clone(),
                    RetiringForward {
                        generation: entry.generation,
                        finished: entry.finished.clone(),
                    },
                );
            }
            entry
        };
        let Some(entry) = entry else {
            return false;
        };
        let _ = entry.shutdown.send(true);
        wait_finished(entry.finished).await;
        clear_retiring(&self.retiring, &spec.id, entry.generation);
        true
    }

    pub fn stop_all(&self) {
        // Serialize cleanup with the point where a pending start becomes
        // active. Otherwise a start waiting on an older retired task can
        // insert itself after a page-reload cleanup has already drained the
        // active map.
        let mut lifecycle = self.lifecycle.lock();
        *lifecycle = lifecycle.wrapping_add(1);
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
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        emit(
            app,
            &self.runtime,
            &self.next_sequence,
            id,
            generation,
            "error",
            Some(error),
        );
    }

    pub fn report_stopped(&self, app: &AppHandle, id: &str) {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        emit(
            app,
            &self.runtime,
            &self.next_sequence,
            id,
            generation,
            "stopped",
            None,
        );
    }

    pub async fn start(
        &self,
        app: AppHandle,
        prompts: ConnectionPrompts,
        spec: ForwardSpec,
    ) -> AppResult<()> {
        let lifecycle = *self.lifecycle.lock();
        let reservation = StartReservation {
            lifecycle,
            token: self.next_reservation.fetch_add(1, Ordering::Relaxed) + 1,
        };
        if self.active.lock().contains_key(&spec.id) {
            return Ok(());
        }
        {
            let mut preparing = self.preparing.lock();
            if preparing
                .get(&spec.id)
                .is_some_and(|pending| pending.lifecycle == lifecycle)
            {
                return Ok(());
            }
            preparing.insert(spec.id.clone(), reservation);
        }
        let _start_guard = StartGuard {
            id: spec.id.clone(),
            reservation,
            preparing: self.preparing.clone(),
        };
        let retiring = self.retiring.lock().remove(&spec.id);
        if let Some(retiring) = retiring {
            wait_finished(retiring.finished).await;
        }
        if self.active.lock().contains_key(&spec.id) {
            return Ok(());
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        let (ready_tx, ready_rx) = oneshot::channel();
        let (finished_tx, finished_rx) = watch::channel(false);

        {
            let current_lifecycle = self.lifecycle.lock();
            let mut active = self.active.lock();
            let preparing = self.preparing.lock();
            if *current_lifecycle != lifecycle || preparing.get(&spec.id) != Some(&reservation) {
                return Err(AppError::Cancelled);
            }
            if active.contains_key(&spec.id) {
                return Ok(());
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

        emit(
            &app,
            &self.runtime,
            &self.next_sequence,
            &spec.id,
            generation,
            "starting",
            None,
        );

        let active = self.active.clone();
        let runtime = self.runtime.clone();
        let next_sequence = self.next_sequence.clone();
        tokio::spawn(async move {
            run_forward(
                app,
                prompts,
                spec.clone(),
                generation,
                shutdown_rx,
                ready_tx,
                runtime,
                next_sequence,
            )
            .await;
            remove_finished(&active, &spec.id, generation);
            let _ = finished_tx.send(true);
        });

        ready_rx.await.unwrap_or(Err(AppError::Cancelled))
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
        .is_some_and(|current| current.generation == generation)
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

fn emit(
    app: &AppHandle,
    runtime: &Mutex<HashMap<String, StatusEvent>>,
    next_sequence: &AtomicU64,
    id: &str,
    generation: u64,
    status: &str,
    error: Option<&AppError>,
) {
    emit_with_public_bind(
        app,
        runtime,
        next_sequence,
        id,
        generation,
        status,
        error,
        false,
    );
}

#[allow(clippy::too_many_arguments)]
fn emit_with_public_bind(
    app: &AppHandle,
    runtime: &Mutex<HashMap<String, StatusEvent>>,
    next_sequence: &AtomicU64,
    id: &str,
    generation: u64,
    status: &str,
    error: Option<&AppError>,
    public_bind_restricted: bool,
) {
    let event = StatusEvent {
        forward_id: id.to_string(),
        status: status.to_string(),
        message: error.map(ToString::to_string),
        code: error.map(|error| error.code().to_string()),
        generation,
        sequence: next_sequence.fetch_add(1, Ordering::Relaxed) + 1,
        public_bind_restricted,
    };
    runtime.lock().insert(id.to_string(), event.clone());
    let _ = app.emit(EVENT_STATUS, event);
}

#[allow(clippy::too_many_arguments)]
async fn run_forward(
    app: AppHandle,
    prompts: ConnectionPrompts,
    spec: ForwardSpec,
    generation: u64,
    mut shutdown: watch::Receiver<bool>,
    ready: oneshot::Sender<AppResult<()>>,
    runtime: Arc<Mutex<HashMap<String, StatusEvent>>>,
    next_sequence: Arc<AtomicU64>,
) {
    if spec.kind == kind::REMOTE {
        run_remote_forward(
            app,
            prompts,
            spec,
            generation,
            shutdown,
            ready,
            runtime,
            next_sequence,
        )
        .await;
        return;
    }

    let bind = tokio::select! {
        result = tokio::time::timeout(
            BIND_TIMEOUT,
            TcpListener::bind((spec.bind_host.as_str(), spec.bind_port)),
        ) => match result {
            Ok(Ok(listener)) => Ok(listener),
            Ok(Err(error)) => Err(AppError::Other(bind_message(&spec, error))),
            Err(_) => Err(AppError::Timeout(format!(
                "binding {}:{} timed out",
                spec.bind_host, spec.bind_port
            ))),
        },
        _ = shutdown.changed() => Err(AppError::Cancelled),
    };
    let listener = match bind {
        Ok(listener) => listener,
        Err(error) => {
            let status = if matches!(error, AppError::Cancelled) {
                "stopped"
            } else {
                "error"
            };
            emit(
                &app,
                &runtime,
                &next_sequence,
                &spec.id,
                generation,
                status,
                (status == "error").then_some(&error),
            );
            let _ = ready.send(Err(error));
            return;
        }
    };

    let conn = tokio::select! {
        result = establish(&app, &prompts, &spec.id, &spec.hops) => match result {
            Ok(conn) => Arc::new(conn),
            Err(error) => {
                emit(
                    &app,
                    &runtime,
                    &next_sequence,
                    &spec.id,
                    generation,
                    "error",
                    Some(&error),
                );
                let _ = ready.send(Err(error));
                return;
            }
        },
        _ = shutdown.changed() => {
            emit(
                &app,
                &runtime,
                &next_sequence,
                &spec.id,
                generation,
                "stopped",
                None,
            );
            let _ = ready.send(Err(AppError::Cancelled));
            return;
        }
    };

    let _ = ready.send(Ok(()));
    emit(
        &app,
        &runtime,
        &next_sequence,
        &spec.id,
        generation,
        "active",
        None,
    );

    let mut connections = JoinSet::new();
    let mut connection_check = tokio::time::interval_at(
        Instant::now() + CONNECTION_CHECK_INTERVAL,
        CONNECTION_CHECK_INTERVAL,
    );
    connection_check.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let terminal_error = loop {
        tokio::select! {
            accepted = listener.accept(), if connections.len() < MAX_FORWARD_CONNECTIONS => {
                match accepted {
                    Ok((stream, _peer)) => {
                        let conn = conn.clone();
                        let spec = spec.clone();
                        let child = shutdown.clone();
                        connections.spawn(async move {
                            let _ = serve_connection(conn, spec, stream, child).await;
                        });
                    }
                    Err(error) => break Some(AppError::Io(error)),
                }
            }
            _ = shutdown.changed() => break None,
            _ = connection_check.tick() => {
                if conn.handle.is_closed() {
                    break Some(AppError::Network("SSH connection for port forward was closed".into()));
                }
            }
            result = connections.join_next(), if !connections.is_empty() => {
                if let Some(Err(error)) = result {
                    break Some(AppError::Other(format!("port forward connection task failed: {error}")));
                }
            }
        }
    };

    connections.shutdown().await;
    match terminal_error {
        Some(error) => emit(
            &app,
            &runtime,
            &next_sequence,
            &spec.id,
            generation,
            "error",
            Some(&error),
        ),
        None => emit(
            &app,
            &runtime,
            &next_sequence,
            &spec.id,
            generation,
            "stopped",
            None,
        ),
    }
}

async fn remote_listener_is_loopback_only(conn: &SshConnection, spec: &ForwardSpec) -> bool {
    if !requests_non_loopback_bind(&spec.bind_host) {
        return false;
    }
    remote_listener_output(conn, spec)
        .await
        .is_some_and(|output| listener_output_is_loopback_only(&output))
}

async fn remote_bind_setup_required(conn: &SshConnection, spec: &ForwardSpec) -> bool {
    if !requests_non_loopback_bind(&spec.bind_host) {
        return false;
    }
    remote_listener_output(conn, spec)
        .await
        .is_some_and(|output| output.trim().is_empty())
}

async fn remote_listener_output(conn: &SshConnection, spec: &ForwardSpec) -> Option<String> {
    let command = format!(
        "command -v ss >/dev/null 2>&1 && ss -H -ltn 'sport = :{}'",
        spec.bind_port
    );
    let output = tokio::time::timeout(
        REMOTE_LISTENER_CHECK_TIMEOUT,
        exec_capture_limited(&conn.handle, &command, MAX_REMOTE_LISTENER_OUTPUT_BYTES),
    )
    .await;
    let Ok(Ok(output)) = output else {
        return None;
    };
    (output.code == 0).then_some(output.stdout)
}

fn requests_non_loopback_bind(host: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    if host == "localhost" {
        return false;
    }
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(&host);
    !unbracketed
        .parse::<std::net::IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

fn listener_output_is_loopback_only(output: &str) -> bool {
    let addresses = output
        .lines()
        .filter_map(|line| line.split_whitespace().nth(3));
    let mut found = false;
    for address in addresses {
        found = true;
        if !address.starts_with("127.") && !address.starts_with("[::1]:") {
            return false;
        }
    }
    found
}

#[allow(clippy::too_many_arguments)]
async fn run_remote_forward(
    app: AppHandle,
    prompts: ConnectionPrompts,
    spec: ForwardSpec,
    generation: u64,
    mut shutdown: watch::Receiver<bool>,
    ready: oneshot::Sender<AppResult<()>>,
    runtime: Arc<Mutex<HashMap<String, StatusEvent>>>,
    next_sequence: Arc<AtomicU64>,
) {
    let (forwarded_tx, mut forwarded_rx) = mpsc::channel(MAX_FORWARD_CONNECTIONS);
    let conn = tokio::select! {
        result = establish_with_forwarded_tcpip(
            &app,
            &prompts,
            &spec.id,
            &spec.hops,
            Some(forwarded_tx),
        ) => match result {
            Ok(conn) => Arc::new(conn),
            Err(error) => {
                emit(&app, &runtime, &next_sequence, &spec.id, generation, "error", Some(&error));
                let _ = ready.send(Err(error));
                return;
            }
        },
        _ = shutdown.changed() => {
            emit(&app, &runtime, &next_sequence, &spec.id, generation, "stopped", None);
            let _ = ready.send(Err(AppError::Cancelled));
            return;
        }
    };

    let registered = tokio::select! {
        result = tokio::time::timeout(
            CHANNEL_OPEN_TIMEOUT,
            conn.handle.tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32),
        ) => match result {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => Err(AppError::Ssh(error)),
            Err(_) => Err(AppError::Timeout(format!(
                "requesting remote bind {}:{} timed out",
                spec.bind_host, spec.bind_port
            ))),
        },
        _ = shutdown.changed() => Err(AppError::Cancelled),
    };
    if let Err(error) = registered {
        let status = if matches!(error, AppError::Cancelled) {
            "stopped"
        } else {
            "error"
        };
        let public_bind_restricted = if status == "error" {
            remote_bind_setup_required(&conn, &spec).await
        } else {
            false
        };
        emit_with_public_bind(
            &app,
            &runtime,
            &next_sequence,
            &spec.id,
            generation,
            status,
            (status == "error").then_some(&error),
            public_bind_restricted,
        );
        let _ = if public_bind_restricted {
            ready.send(Ok(()))
        } else {
            ready.send(Err(error))
        };
        return;
    }

    let public_bind_restricted = remote_listener_is_loopback_only(&conn, &spec).await;
    let _ = ready.send(Ok(()));
    emit_with_public_bind(
        &app,
        &runtime,
        &next_sequence,
        &spec.id,
        generation,
        "active",
        None,
        public_bind_restricted,
    );

    let target_host = match spec.target_host.clone() {
        Some(host) => host,
        None => {
            let error = AppError::Invalid("missing remote forward target host".into());
            emit(
                &app,
                &runtime,
                &next_sequence,
                &spec.id,
                generation,
                "error",
                Some(&error),
            );
            return;
        }
    };
    let target_port = match spec.target_port {
        Some(port) => port,
        None => {
            let error = AppError::Invalid("missing remote forward target port".into());
            emit(
                &app,
                &runtime,
                &next_sequence,
                &spec.id,
                generation,
                "error",
                Some(&error),
            );
            return;
        }
    };

    let mut connections = JoinSet::new();
    let mut connection_check = tokio::time::interval_at(
        Instant::now() + CONNECTION_CHECK_INTERVAL,
        CONNECTION_CHECK_INTERVAL,
    );
    connection_check.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let terminal_error = loop {
        tokio::select! {
            channel = forwarded_rx.recv(), if connections.len() < MAX_FORWARD_CONNECTIONS => {
                let Some(channel) = channel else {
                    break Some(AppError::Network("SSH connection for remote port forward was closed".into()));
                };
                let host = target_host.clone();
                let mut child = shutdown.clone();
                connections.spawn(async move {
                    let mut local = tokio::select! {
                        result = tokio::time::timeout(CHANNEL_OPEN_TIMEOUT, TcpStream::connect((host.as_str(), target_port))) => {
                            result.map_err(|_| AppError::Timeout("connecting remote forward target timed out".into()))??
                        }
                        _ = child.changed() => return Ok::<(), AppError>(()),
                    };
                    let mut remote = channel.into_stream();
                    tokio::select! {
                        result = tokio::io::copy_bidirectional(&mut local, &mut remote) => {
                            result?;
                            Ok::<(), AppError>(())
                        }
                        _ = child.changed() => Ok(()),
                    }
                });
            }
            _ = shutdown.changed() => break None,
            _ = connection_check.tick() => {
                if conn.handle.is_closed() {
                    break Some(AppError::Network("SSH connection for remote port forward was closed".into()));
                }
            }
            result = connections.join_next(), if !connections.is_empty() => {
                if let Some(Err(error)) = result {
                    break Some(AppError::Other(format!("remote forward connection task failed: {error}")));
                }
            }
        }
    };

    let _ = tokio::time::timeout(
        CHANNEL_OPEN_TIMEOUT,
        conn.handle
            .cancel_tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32),
    )
    .await;
    connections.shutdown().await;
    match terminal_error {
        Some(error) => emit(
            &app,
            &runtime,
            &next_sequence,
            &spec.id,
            generation,
            "error",
            Some(&error),
        ),
        None => emit(
            &app,
            &runtime,
            &next_sequence,
            &spec.id,
            generation,
            "stopped",
            None,
        ),
    }
}

fn bind_message(spec: &ForwardSpec, error: std::io::Error) -> String {
    if spec.bind_port < 1024 {
        format!(
            "could not bind {}:{} ({error}). Ports below 1024 usually need elevated privileges.",
            spec.bind_host, spec.bind_port
        )
    } else {
        format!(
            "could not bind {}:{} ({error})",
            spec.bind_host, spec.bind_port
        )
    }
}

async fn serve_connection(
    conn: Arc<SshConnection>,
    spec: ForwardSpec,
    mut stream: TcpStream,
    mut shutdown: watch::Receiver<bool>,
) -> AppResult<()> {
    tokio::select! {
        biased;
        _ = shutdown.changed() => Ok(()),
        result = serve_connection_inner(conn, spec, &mut stream) => result,
    }
}

async fn serve_connection_inner(
    conn: Arc<SshConnection>,
    spec: ForwardSpec,
    stream: &mut TcpStream,
) -> AppResult<()> {
    let dynamic = spec.kind == kind::DYNAMIC;
    let (target_host, target_port) = if dynamic {
        tokio::time::timeout(SOCKS_HANDSHAKE_TIMEOUT, socks5_request(stream))
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
        conn.handle
            .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0),
    )
    .await;
    let channel = match opened {
        Ok(Ok(channel)) => channel,
        Ok(Err(error)) => {
            if dynamic {
                let _ = socks5_reply(stream, 0x01).await;
            }
            return Err(AppError::Ssh(error));
        }
        Err(_) => {
            if dynamic {
                let _ = socks5_reply(stream, 0x06).await;
            }
            return Err(AppError::Timeout(
                "opening the forwarded SSH channel timed out".into(),
            ));
        }
    };

    if dynamic {
        socks5_reply(stream, 0x00).await?;
    }
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(stream, &mut channel_stream).await?;
    Ok(())
}

async fn socks5_reply<S>(stream: &mut S, status: u8) -> AppResult<()>
where
    S: AsyncWriteExt + Unpin,
{
    stream
        .write_all(&[0x05, status, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
    Ok(())
}

async fn socks5_request<S>(stream: &mut S) -> AppResult<(String, u16)>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 {
        return Err(AppError::Invalid("unsupported SOCKS version".into()));
    }
    if header[1] == 0 {
        stream.write_all(&[0x05, 0xff]).await?;
        return Err(AppError::Invalid("no SOCKS authentication methods".into()));
    }
    let mut methods = vec![0u8; header[1] as usize];
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
            let mut addr = [0u8; 4];
            stream.read_exact(&mut addr).await?;
            std::net::Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            if len[0] == 0 {
                socks5_reply(stream, 0x08).await?;
                return Err(AppError::Invalid("empty SOCKS domain name".into()));
            }
            let mut name = vec![0u8; len[0] as usize];
            stream.read_exact(&mut name).await?;
            match String::from_utf8(name) {
                Ok(name) => name,
                Err(_) => {
                    socks5_reply(stream, 0x08).await?;
                    return Err(AppError::Invalid("SOCKS domain name is not UTF-8".into()));
                }
            }
        }
        0x04 => {
            let mut addr = [0u8; 16];
            stream.read_exact(&mut addr).await?;
            std::net::Ipv6Addr::from(addr).to_string()
        }
        _ => {
            socks5_reply(stream, 0x08).await?;
            return Err(AppError::Invalid("unsupported SOCKS address type".into()));
        }
    };

    let mut port = [0u8; 2];
    stream.read_exact(&mut port).await?;
    let port = u16::from_be_bytes(port);
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
            let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
            req.extend_from_slice(host);
            req.extend_from_slice(&8080u16.to_be_bytes());
            client.write_all(&req).await.unwrap();

            let mut reply = [0u8; 10];
            assert!(
                tokio::time::timeout(Duration::from_millis(20), client.read_exact(&mut reply),)
                    .await
                    .is_err()
            );
        });

        let (host, port) = socks5_request(&mut server).await.unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 8080);
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
    async fn socks5_rejects_non_connect_and_zero_port() {
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
    fn old_generation_cannot_remove_new_forward() {
        let active = Mutex::new(HashMap::new());
        let (old_shutdown, _) = watch::channel(false);
        let (_, old_finished) = watch::channel(false);
        active.lock().insert(
            "forward".into(),
            ActiveForward {
                generation: 2,
                spec: forward_spec(80),
                shutdown: old_shutdown,
                finished: old_finished,
            },
        );

        remove_finished(&active, "forward", 1);
        assert_eq!(active.lock().get("forward").unwrap().generation, 2);
        remove_finished(&active, "forward", 2);
        assert!(!active.lock().contains_key("forward"));
    }

    #[tokio::test]
    async fn conditional_stop_does_not_stop_a_replacement() {
        let manager = ForwardManager::new();
        let current = forward_spec(80);
        let (shutdown, _) = watch::channel(false);
        let (finished, finished_rx) = watch::channel(false);
        manager.active.lock().insert(
            current.id.clone(),
            ActiveForward {
                generation: 1,
                spec: current.clone(),
                shutdown,
                finished: finished_rx,
            },
        );
        manager.preparing.lock().insert(
            current.id.clone(),
            StartReservation {
                lifecycle: 0,
                token: 1,
            },
        );

        assert!(!manager.stop_if_spec(&forward_spec(81)).await);
        assert!(manager.active_specs().iter().any(|spec| spec == &current));
        assert!(manager.preparing.lock().contains_key(&current.id));

        let _ = finished.send(true);
        assert!(manager.stop_if_spec(&current).await);
        assert!(manager.active_specs().is_empty());
        assert!(!manager.preparing.lock().contains_key(&current.id));
    }

    #[test]
    fn stop_all_invalidates_pending_start_lifecycle() {
        let manager = ForwardManager::new();
        let pending_lifecycle = *manager.lifecycle.lock();

        manager.stop_all();

        assert_ne!(*manager.lifecycle.lock(), pending_lifecycle);
    }

    #[test]
    fn stale_start_guard_does_not_clear_a_new_reservation() {
        let first = StartReservation {
            lifecycle: 1,
            token: 1,
        };
        let second = StartReservation {
            lifecycle: 1,
            token: 2,
        };
        let preparing = Arc::new(Mutex::new(HashMap::from([("forward".into(), first)])));
        let guard = StartGuard {
            id: "forward".into(),
            reservation: first,
            preparing: preparing.clone(),
        };
        preparing.lock().insert("forward".into(), second);

        drop(guard);

        assert_eq!(preparing.lock().get("forward"), Some(&second));
    }

    #[test]
    fn detects_loopback_only_remote_listener() {
        let loopback = "LISTEN 0 128 127.0.0.1:8020 0.0.0.0:*\nLISTEN 0 128 [::1]:8020 [::]:*\n";
        let public = "LISTEN 0 128 0.0.0.0:8020 0.0.0.0:*\n";

        assert!(listener_output_is_loopback_only(loopback));
        assert!(!listener_output_is_loopback_only(public));
        assert!(!listener_output_is_loopback_only(""));
    }

    #[test]
    fn recognizes_non_loopback_bind_requests() {
        assert!(!requests_non_loopback_bind("127.0.0.1"));
        assert!(!requests_non_loopback_bind("127.0.0.2"));
        assert!(requests_non_loopback_bind("127.example.com"));
        assert!(requests_non_loopback_bind("127.0.0.999"));
        assert!(!requests_non_loopback_bind("LOCALHOST"));
        assert!(!requests_non_loopback_bind("[::1]"));
        assert!(requests_non_loopback_bind("0.0.0.0"));
        assert!(requests_non_loopback_bind("203.0.113.10"));
    }

    #[tokio::test]
    async fn stop_clears_a_pending_start_reservation() {
        let manager = ForwardManager::new();
        manager.preparing.lock().insert(
            "forward".into(),
            StartReservation {
                lifecycle: 0,
                token: 1,
            },
        );

        assert!(manager.stop("forward").await);
        assert!(!manager.preparing.lock().contains_key("forward"));
    }

    #[tokio::test]
    async fn stop_and_restart_can_wait_for_the_same_retirement() {
        let manager = Arc::new(ForwardManager::new());
        let (shutdown, _) = watch::channel(false);
        let (finished, finished_rx) = watch::channel(false);
        manager.active.lock().insert(
            "forward".into(),
            ActiveForward {
                generation: 1,
                spec: forward_spec(80),
                shutdown,
                finished: finished_rx,
            },
        );

        let stop_manager = manager.clone();
        let stop = tokio::spawn(async move { stop_manager.stop("forward").await });
        tokio::task::yield_now().await;
        let restart_wait = manager
            .retiring
            .lock()
            .get("forward")
            .map(|retiring| retiring.finished.clone())
            .unwrap();
        let restart = tokio::spawn(wait_finished(restart_wait));

        finished.send(true).unwrap();
        assert!(stop.await.unwrap());
        restart.await.unwrap();
        assert!(!manager.retiring.lock().contains_key("forward"));
    }
}
