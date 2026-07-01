//! SSH session manager built on libssh2 (`ssh2`).
//!
//! Each interactive session runs on its own OS thread: the thread owns the
//! blocking `ssh2::Session`/`Channel`, pumps terminal output to the frontend as
//! Tauri events, and applies input/resize/close commands received over a
//! channel. This keeps all non-`Send` SSH state confined to one thread while
//! exposing a simple async-free API to the rest of the app.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub const EVENT_DATA: &str = "ssh://data";
pub const EVENT_STATUS: &str = "ssh://status";

/// How often to send an SSH keepalive probe on an otherwise idle session.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub enum AuthMethod {
    Password(String),
    Key {
        private_key: String,
        public_key: Option<String>,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, Clone)]
pub struct ConnectParams {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub cols: u32,
    pub rows: u32,
}

enum SessionCommand {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct SessionHandle {
    tx: Sender<SessionCommand>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataEvent {
    id: String,
    /// Base64-encoded raw bytes (terminal output may be binary).
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    id: String,
    /// "connecting" | "connected" | "closed" | "error"
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

type SessionMap = Arc<Mutex<HashMap<String, SessionHandle>>>;

#[derive(Default)]
pub struct SessionManager {
    sessions: SessionMap,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a session on its own thread. Returns immediately; connection
    /// progress is reported through `ssh://status` events.
    pub fn connect(&self, app: AppHandle, params: ConnectParams) -> AppResult<()> {
        let id = params.session_id.clone();
        let (tx, rx) = mpsc::channel::<SessionCommand>();

        {
            let mut sessions = self.sessions.lock();
            if sessions.contains_key(&id) {
                // A live session already exists for this id (e.g. React
                // StrictMode re-invoked `connect`). Ignore the duplicate:
                // spawning a second thread would orphan the first, which then
                // emits a spurious "closed" for the shared id and stomps the
                // tab's status back to a disconnected state.
                return Ok(());
            }
            sessions.insert(id.clone(), SessionHandle { tx });
        }

        let sessions = self.sessions.clone();
        let thread_id = id.clone();
        let spawn = std::thread::Builder::new()
            .name(format!("ssh-{id}"))
            .spawn(move || {
                run_session(app, params, rx);
                // Drop our handle on exit so the map only ever holds live
                // sessions and a later reconnect with this id is not blocked.
                sessions.lock().remove(&thread_id);
            });

        if let Err(e) = spawn {
            self.sessions.lock().remove(&id);
            return Err(AppError::Io(e));
        }

        Ok(())
    }

    pub fn send_input(&self, id: &str, data: Vec<u8>) -> AppResult<()> {
        self.dispatch(id, SessionCommand::Input(data))
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> AppResult<()> {
        self.dispatch(id, SessionCommand::Resize(cols, rows))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        if let Some(handle) = self.sessions.lock().remove(id) {
            let _ = handle.tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    fn dispatch(&self, id: &str, cmd: SessionCommand) -> AppResult<()> {
        let sessions = self.sessions.lock();
        let handle = sessions
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        handle
            .tx
            .send(cmd)
            .map_err(|_| AppError::Other("session is no longer running".into()))
    }
}

fn emit_status(app: &AppHandle, id: &str, status: &str, message: Option<String>) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            id: id.to_string(),
            status: status.to_string(),
            message,
        },
    );
}

/// Blocking session lifecycle, run on a dedicated thread.
fn run_session(app: AppHandle, params: ConnectParams, rx: Receiver<SessionCommand>) {
    let id = params.session_id.clone();
    emit_status(&app, &id, "connecting", None);

    if let Err(e) = run_session_inner(&app, &params, rx) {
        emit_status(&app, &id, "error", Some(e.to_string()));
    } else {
        emit_status(&app, &id, "closed", None);
    }
}

fn run_session_inner(
    app: &AppHandle,
    params: &ConnectParams,
    rx: Receiver<SessionCommand>,
) -> AppResult<()> {
    let id = &params.session_id;

    let tcp = TcpStream::connect((params.host.as_str(), params.port))?;
    let mut session = ssh2::Session::new()?;
    session.set_tcp_stream(tcp);
    session.handshake()?;

    authenticate(&session, &params.username, &params.auth)?;

    let mut channel = session.channel_session()?;
    channel.request_pty(
        "xterm-256color",
        None,
        Some((params.cols, params.rows, 0, 0)),
    )?;
    channel.shell()?;

    emit_status(app, id, "connected", None);

    // Ask libssh2 to keep the connection alive so idle sessions are not dropped
    // by the server or an intervening NAT/firewall. `want_reply = true` makes
    // the peer acknowledge each probe, so a dead link surfaces as a read error.
    session.set_keepalive(true, KEEPALIVE_INTERVAL.as_secs() as u32);

    // Non-blocking I/O so the single event loop can interleave reads, writes,
    // and control commands without ever blocking on any one of them.
    session.set_blocking(false);

    let mut buf = [0u8; 32 * 1024];
    // Bytes typed by the user that still need to reach the remote. In
    // non-blocking mode a write can make only partial progress (EAGAIN) when the
    // channel's send window is momentarily full, so we keep the remainder here
    // and retry on later iterations instead of treating it as a fatal error.
    let mut outbuf: Vec<u8> = Vec::new();
    let mut sent = 0usize;
    let mut needs_flush = false;
    let mut next_keepalive = Instant::now() + KEEPALIVE_INTERVAL;
    loop {
        // Drain pending control commands first.
        loop {
            match rx.try_recv() {
                Ok(SessionCommand::Input(data)) => outbuf.extend_from_slice(&data),
                Ok(SessionCommand::Resize(cols, rows)) => {
                    let _ = channel.request_pty_size(cols, rows, None, None);
                }
                Ok(SessionCommand::Close) => {
                    let _ = channel.close();
                    return Ok(());
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
            }
        }

        // Push queued input to the remote. WouldBlock just means the send window
        // is full right now; we keep the rest and let the next iteration retry
        // while reads below continue draining the window.
        while sent < outbuf.len() {
            match channel.write(&outbuf[sent..]) {
                Ok(0) => break,
                Ok(n) => {
                    sent += n;
                    needs_flush = true;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(AppError::Io(e)),
            }
        }
        if sent > 0 && sent == outbuf.len() {
            outbuf.clear();
            sent = 0;
        }
        if needs_flush {
            match channel.flush() {
                Ok(()) => needs_flush = false,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(AppError::Io(e)),
            }
        }

        match channel.read(&mut buf) {
            Ok(0) => {
                if channel.eof() {
                    return Ok(());
                }
            }
            Ok(n) => {
                let _ = app.emit(
                    EVENT_DATA,
                    DataEvent {
                        id: id.clone(),
                        data: STANDARD.encode(&buf[..n]),
                    },
                );
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(AppError::Io(e)),
        }

        if channel.eof() {
            return Ok(());
        }

        // Send a keepalive probe when due. libssh2 only emits probes while we
        // poke it, so we drive it from the event loop.
        if Instant::now() >= next_keepalive {
            let _ = session.keepalive_send();
            next_keepalive = Instant::now() + KEEPALIVE_INTERVAL;
        }

        std::thread::sleep(Duration::from_millis(5));
    }
}

pub(crate) fn authenticate(
    session: &ssh2::Session,
    username: &str,
    auth: &AuthMethod,
) -> AppResult<()> {
    match auth {
        AuthMethod::Password(password) => {
            session.userauth_password(username, password)?;
        }
        AuthMethod::Key {
            private_key,
            public_key,
            passphrase,
        } => {
            session.userauth_pubkey_memory(
                username,
                public_key.as_deref(),
                private_key,
                passphrase.as_deref(),
            )?;
        }
        AuthMethod::Agent => {
            session.userauth_agent(username)?;
        }
    }

    if !session.authenticated() {
        return Err(AppError::Other("authentication failed".into()));
    }
    Ok(())
}
