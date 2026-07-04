//! SSH session manager built on libssh2 (`ssh2`).
//!
//! Each interactive session runs on its own OS thread: the thread owns the
//! blocking `ssh2::Session`/`Channel`, pumps terminal output to the frontend as
//! Tauri events, and applies input/resize/close commands received over a
//! channel. This keeps all non-`Send` SSH state confined to one thread while
//! exposing a simple async-free API to the rest of the app.

use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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
pub(crate) const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

/// Upper bound for the blocking connect/handshake/auth phase, so a dead
/// network fails fast instead of hanging the session thread forever.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How many 32 KiB reads to drain per loop tick before yielding, so a burst
/// of output (e.g. `cat` on a large file) still keeps the UI responsive.
const MAX_READS_PER_TICK: usize = 16;

/// Keep writes under libssh2's single SSH packet limit. More importantly, the
/// exact same slice must be retried after EAGAIN, so we write one stable chunk
/// at a time instead of repeatedly handing libssh2 a growing Vec.
const MAX_WRITE_CHUNK: usize = 32_700;

const LIBSSH2_EAGAIN: i32 = -37;
const LIBSSH2_SOCKET_SEND: i32 = -7;
const LIBSSH2_TIMEOUT: i32 = -9;
const LIBSSH2_SOCKET_DISCONNECT: i32 = -13;
const LIBSSH2_SOCKET_TIMEOUT: i32 = -30;
const LIBSSH2_SOCKET_RECV: i32 = -43;
const LIBSSH2_BAD_SOCKET: i32 = -45;
const LIBSSH2_FX_NO_CONNECTION: i32 = 6;
const LIBSSH2_FX_CONNECTION_LOST: i32 = 7;

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

#[derive(Default)]
struct OutputQueue {
    chunks: VecDeque<Vec<u8>>,
    front_offset: usize,
    retry_len: Option<usize>,
}

impl OutputQueue {
    fn push(&mut self, data: Vec<u8>) {
        if !data.is_empty() {
            self.chunks.push_back(data);
        }
    }

    fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    fn is_retrying(&self) -> bool {
        self.retry_len.is_some()
    }

    fn current_len(&self) -> Option<usize> {
        let front = self.chunks.front()?;
        let remaining = front.len().checked_sub(self.front_offset)?;
        if remaining == 0 {
            return None;
        }
        Some(self.retry_len.unwrap_or(remaining.min(MAX_WRITE_CHUNK)))
    }

    fn current_slice(&self) -> Option<&[u8]> {
        let len = self.current_len()?;
        let front = self.chunks.front()?;
        Some(&front[self.front_offset..self.front_offset + len])
    }

    fn mark_retry(&mut self, len: usize) {
        self.retry_len = Some(len);
    }

    fn advance(&mut self, n: usize) {
        self.retry_len = None;
        self.front_offset += n;
        while self
            .chunks
            .front()
            .is_some_and(|front| self.front_offset >= front.len())
        {
            self.chunks.pop_front();
            self.front_offset = 0;
        }
    }
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
    /// Machine-readable [`AppError::code`], set only for "error" — lets the
    /// frontend show a localized message instead of the raw `message` above.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
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

fn emit_status(app: &AppHandle, id: &str, status: &str) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            id: id.to_string(),
            status: status.to_string(),
            message: None,
            code: None,
        },
    );
}

fn emit_error_status(app: &AppHandle, id: &str, err: &AppError) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            id: id.to_string(),
            status: "error".to_string(),
            message: Some(err.to_string()),
            code: Some(err.code().to_string()),
        },
    );
}

/// Blocking session lifecycle, run on a dedicated thread.
fn run_session(app: AppHandle, params: ConnectParams, rx: Receiver<SessionCommand>) {
    let id = params.session_id.clone();
    emit_status(&app, &id, "connecting");

    if let Err(e) = run_session_inner(&app, &params, rx) {
        emit_error_status(&app, &id, &e);
    } else {
        emit_status(&app, &id, "closed");
    }
}

/// A broken link mid-session (reset, NAT drop, server kill) surfaces as an
/// opaque libssh2 transport error ("transport read"); translate it into a
/// message a user can act on.
pub(crate) fn connection_lost(e: impl fmt::Display) -> AppError {
    AppError::Other(format!("connection lost: {e}"))
}

pub(crate) fn is_ssh_would_block(e: &ssh2::Error) -> bool {
    e.code() == ssh2::ErrorCode::Session(LIBSSH2_EAGAIN)
}

pub(crate) fn is_ssh_transport_error(e: &ssh2::Error) -> bool {
    match e.code() {
        ssh2::ErrorCode::Session(
            LIBSSH2_SOCKET_SEND
            | LIBSSH2_TIMEOUT
            | LIBSSH2_SOCKET_DISCONNECT
            | LIBSSH2_SOCKET_TIMEOUT
            | LIBSSH2_SOCKET_RECV
            | LIBSSH2_BAD_SOCKET,
        )
        | ssh2::ErrorCode::SFTP(LIBSSH2_FX_NO_CONNECTION | LIBSSH2_FX_CONNECTION_LOST) => true,
        _ => false,
    }
}

pub(crate) fn map_ssh_error(e: ssh2::Error) -> AppError {
    if is_ssh_transport_error(&e) {
        connection_lost(e)
    } else {
        AppError::Ssh(e)
    }
}

pub(crate) fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let mut last_error = None;
    for addr in (host, port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(tcp) => {
                // Interactive keystrokes and SFTP requests should not sit in
                // Nagle's buffer.
                let _ = tcp.set_nodelay(true);
                return Ok(tcp);
            }
            Err(e) => last_error = Some(e),
        }
    }

    Err(AppError::Io(last_error.unwrap_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("no address resolved for {host}:{port}"),
        )
    })))
}

fn run_session_inner(
    app: &AppHandle,
    params: &ConnectParams,
    rx: Receiver<SessionCommand>,
) -> AppResult<()> {
    let id = &params.session_id;

    let tcp = connect_tcp(&params.host, params.port)?;
    let mut session = ssh2::Session::new()?;
    session.set_tcp_stream(tcp);
    // Bound the blocking connect phase (handshake + auth); 0 = no timeout.
    session.set_timeout(CONNECT_TIMEOUT.as_millis() as u32);
    session.handshake()?;

    authenticate(&session, &params.username, &params.auth)?;

    let mut channel = session.channel_session()?;
    channel.request_pty(
        "xterm-256color",
        None,
        Some((params.cols, params.rows, 0, 0)),
    )?;
    channel.shell()?;

    emit_status(app, id, "connected");

    // Ask libssh2 to keep the connection alive so idle sessions are not
    // dropped by the server or an intervening NAT/firewall. `want_reply =
    // false`: a probe the peer must answer adds traffic and, more
    // importantly, interleaving its reply with pending channel writes has
    // historically confused libssh2's non-blocking transport. The probe
    // itself is enough to keep NAT/firewall state alive, and a dead TCP link
    // still surfaces as a read/write error.
    session.set_keepalive(false, KEEPALIVE_INTERVAL.as_secs() as u32);

    // Non-blocking I/O so the single event loop can interleave reads, writes,
    // and control commands without ever blocking on any one of them.
    session.set_timeout(0);
    session.set_blocking(false);

    let mut read_buf = [0u8; 32 * 1024];
    let mut output = OutputQueue::default();
    let mut pending_resize: Option<(u32, u32)> = None;
    let mut next_keepalive = Instant::now() + KEEPALIVE_INTERVAL;
    loop {
        let mut made_progress = false;

        // Drain pending control commands first. Input is appended as immutable
        // chunks so a libssh2 EAGAIN retry can reuse the exact same slice.
        loop {
            match rx.try_recv() {
                Ok(SessionCommand::Input(data)) => {
                    output.push(data);
                    made_progress = true;
                }
                Ok(SessionCommand::Resize(cols, rows)) => {
                    pending_resize = Some((cols, rows));
                }
                Ok(SessionCommand::Close) => {
                    let _ = channel.close();
                    return Ok(());
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
            }
        }

        // If the last write returned EAGAIN, libssh2 requires us to retry that
        // exact same buffer before starting unrelated channel operations.
        if !output.is_retrying() {
            if let Some((cols, rows)) = pending_resize {
                match channel.request_pty_size(cols, rows, None, None) {
                    Ok(()) => {
                        pending_resize = None;
                        made_progress = true;
                    }
                    Err(ref e) if is_ssh_would_block(e) => {}
                    // A resize is advisory; a rejected resize should not tear
                    // down an otherwise healthy shell.
                    Err(_) => pending_resize = None,
                }
            }

            // Drain remote output before writing. This gives libssh2 a chance to
            // process window-adjust packets before channel_write performs its own
            // incoming-flow drain.
            for _ in 0..MAX_READS_PER_TICK {
                match channel.read(&mut read_buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        made_progress = true;
                        let _ = app.emit(
                            EVENT_DATA,
                            DataEvent {
                                id: id.clone(),
                                data: STANDARD.encode(&read_buf[..n]),
                            },
                        );
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                    Err(e) => return Err(connection_lost(e)),
                }
            }
        }

        // Push queued input to the remote. WouldBlock means the send window or
        // socket is not ready; the front chunk is kept untouched and retried
        // verbatim on the next pass.
        while let Some(len) = output.current_len() {
            let result = channel.write(output.current_slice().expect("current write chunk"));
            match result {
                Ok(0) => break,
                Ok(n) => {
                    output.advance(n);
                    made_progress = true;
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                    output.mark_retry(len);
                    break;
                }
                Err(e) => return Err(connection_lost(e)),
            }
        }

        if channel.eof() {
            return Ok(());
        }

        // Send keepalive only when channel operations are otherwise quiescent.
        if output.is_empty() && pending_resize.is_none() && Instant::now() >= next_keepalive {
            match session.keepalive_send() {
                // Probe sent (or nothing to do): schedule the next one.
                Ok(_) => next_keepalive = Instant::now() + KEEPALIVE_INTERVAL,
                // EAGAIN: socket buffer full right now, retry next tick.
                Err(ref e) if is_ssh_would_block(e) => {}
                // Keepalive failing outright means the link is gone.
                Err(e) => return Err(connection_lost(e)),
            }
        }

        if !made_progress {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_queue_retries_the_same_front_slice_after_would_block() {
        let mut queue = OutputQueue::default();
        queue.push(b"abcdef".to_vec());

        assert_eq!(queue.current_slice(), Some(&b"abcdef"[..]));
        let len = queue.current_len().unwrap();
        queue.mark_retry(len);
        queue.push(b"gh".to_vec());

        assert_eq!(queue.current_slice(), Some(&b"abcdef"[..]));
    }

    #[test]
    fn output_queue_advances_after_successful_partial_write() {
        let mut queue = OutputQueue::default();
        queue.push(b"abcdef".to_vec());
        queue.mark_retry(6);

        queue.advance(2);

        assert_eq!(queue.current_slice(), Some(&b"cdef"[..]));
    }
}

/// libssh2 codes meaning "the server understood the request and rejected
/// these credentials", as opposed to a network/protocol-level failure —
/// distinguished so a wrong password/key surfaces as [`AppError::Auth`]
/// rather than a raw libssh2 error string.
const AUTH_REJECTED_CODES: [i32; 4] = [
    -15, // LIBSSH2_ERROR_PASSWORD_EXPIRED
    -18, // LIBSSH2_ERROR_AUTHENTICATION_FAILED (also PUBLICKEY_UNRECOGNIZED)
    -19, // LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED
    -48, // LIBSSH2_ERROR_KEYFILE_AUTH_FAILED
];

fn map_auth_error(e: ssh2::Error) -> AppError {
    match e.code() {
        ssh2::ErrorCode::Session(code) if AUTH_REJECTED_CODES.contains(&code) => {
            AppError::Auth("the server rejected these credentials".into())
        }
        _ => AppError::Ssh(e),
    }
}

pub(crate) fn authenticate(
    session: &ssh2::Session,
    username: &str,
    auth: &AuthMethod,
) -> AppResult<()> {
    match auth {
        AuthMethod::Password(password) => session.userauth_password(username, password),
        AuthMethod::Key {
            private_key,
            public_key,
            passphrase,
        } => session.userauth_pubkey_memory(
            username,
            public_key.as_deref(),
            private_key,
            passphrase.as_deref(),
        ),
        AuthMethod::Agent => session.userauth_agent(username),
    }
    .map_err(map_auth_error)?;

    if !session.authenticated() {
        return Err(AppError::Auth(
            "the server rejected these credentials".into(),
        ));
    }
    Ok(())
}
