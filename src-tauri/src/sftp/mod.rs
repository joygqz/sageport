//! SFTP connection manager built on libssh2 (`ssh2`).
//!
//! Each remote connection runs on its own OS thread that owns the blocking
//! `ssh2::Session`/`ssh2::Sftp`, mirroring the model used for interactive shells
//! in [`crate::ssh`]. Commands are sent over a channel and each carries a
//! one-shot reply sender, so the rest of the app talks to SFTP through a simple
//! synchronous request/response API while all non-`Send` state stays on one
//! thread. Transfers stream in chunks and emit progress as Tauri events.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::ssh::{
    authenticate, connect_tcp, connection_lost, is_ssh_would_block, map_ssh_error, AuthMethod,
    CONNECT_TIMEOUT, KEEPALIVE_INTERVAL,
};

pub const EVENT_STATUS: &str = "sftp://status";
pub const EVENT_TRANSFER: &str = "sftp://transfer";

/// Chunk size used when streaming file contents to/from a remote host.
const CHUNK_SIZE: usize = 64 * 1024;

/// Parameters needed to open a remote SFTP connection. Resolved by the command
/// layer from a host's stored credentials.
pub struct SftpConnectParams {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

/// A single directory entry, in a frontend-friendly shape.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    /// "file" | "dir" | "symlink"
    pub kind: String,
    pub size: u64,
    /// Unix seconds, when known.
    pub modified: Option<i64>,
    /// Unix permission bits, when known.
    pub permissions: Option<u32>,
    pub is_symlink: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    connection_id: String,
    /// "connecting" | "connected" | "closed" | "error"
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    /// Machine-readable [`AppError::code`], set only for "error" — lets the
    /// frontend show a localized message instead of the raw `message` above.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

/// Progress for an in-flight transfer. `total`/`transferred` are byte counts;
/// `status` is "active" | "done" | "error" | "cancelled". `phase` is set for
/// compressed transfers ("compressing" | "transferring" | "extracting") and
/// `None` for a plain byte-for-byte copy.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub transfer_id: String,
    pub transferred: u64,
    pub total: u64,
    pub file: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Final result of a [`transfer`] call, used by the command layer to persist
/// history once the transfer settles.
pub struct TransferOutcome {
    pub transferred: u64,
    pub total: u64,
    /// "done" | "error" | "cancelled"
    pub status: &'static str,
    pub message: Option<String>,
}

/// Requests handled on a connection's worker thread. Each carries a one-shot
/// reply channel for its result.
enum SftpRequest {
    List(String, Sender<AppResult<Vec<FileEntry>>>),
    Realpath(String, Sender<AppResult<String>>),
    Mkdir(String, Sender<AppResult<()>>),
    Rename(String, String, Sender<AppResult<()>>),
    Remove {
        path: String,
        is_dir: bool,
        reply: Sender<AppResult<()>>,
    },
    /// Read a remote file into a local path, emitting progress under `base`.
    Download {
        remote: String,
        local: PathBuf,
        progress: ProgressCtx,
        reply: Sender<AppResult<()>>,
    },
    /// Write a local file to a remote path, emitting progress under `base`.
    Upload {
        local: PathBuf,
        remote: String,
        progress: ProgressCtx,
        reply: Sender<AppResult<()>>,
    },
    /// Run a shell command over an exec channel; returns its stdout (used to
    /// drive `tar`/`rm` for compressed transfers).
    Exec {
        command: String,
        reply: Sender<AppResult<String>>,
    },
    Close,
}

/// Per-file progress context so a worker can emit byte-accurate events while a
/// larger (possibly recursive) transfer accumulates totals.
#[derive(Clone)]
struct ProgressCtx {
    transfer_id: String,
    /// Bytes already counted before this file (for multi-file transfers).
    base: u64,
    /// Total bytes across the whole transfer.
    total: u64,
    label: String,
    /// When true, do not emit per-chunk progress (used for the upload half of a
    /// remote→remote bridge so bytes are counted only once).
    silent: bool,
    /// Phase label for compressed transfers; `None` for a plain copy.
    phase: Option<String>,
    /// Flipped by [`SftpManager::cancel_transfer`]; checked between chunks/files
    /// so an in-flight transfer can stop promptly.
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SftpManager {
    conns: Arc<Mutex<HashMap<String, Sender<SftpRequest>>>>,
    /// Cancellation flags for in-flight transfers, keyed by `transfer_id`.
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a fresh cancellation flag for a transfer about to start.
    pub fn register_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancel_flags
            .lock()
            .insert(transfer_id.to_string(), flag.clone());
        flag
    }

    /// Request cancellation of an in-flight transfer. Best-effort: the worker
    /// notices between chunks (or, for compressed transfers, between phases),
    /// so a remote `tar` command already running cannot be interrupted mid-way.
    pub fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(flag) = self.cancel_flags.lock().get(transfer_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Drop a transfer's cancellation flag once it has settled.
    pub fn unregister_transfer(&self, transfer_id: &str) {
        self.cancel_flags.lock().remove(transfer_id);
    }

    /// Open a remote connection on its own thread. Returns immediately; progress
    /// is reported via `sftp://status` events.
    pub fn connect(&self, app: AppHandle, params: SftpConnectParams) -> AppResult<()> {
        let (tx, rx) = mpsc::channel::<SftpRequest>();
        let id = params.connection_id.clone();
        {
            let mut conns = self.conns.lock();
            if conns.contains_key(&id) {
                return Ok(());
            }
            conns.insert(id.clone(), tx);
        }

        let conns = self.conns.clone();
        let thread_id = id.clone();
        let spawn = std::thread::Builder::new()
            .name(format!("sftp-{id}"))
            .spawn(move || {
                run_connection(app, params, rx);
                conns.lock().remove(&thread_id);
            });

        if let Err(e) = spawn {
            self.conns.lock().remove(&id);
            return Err(AppError::Io(e));
        }

        Ok(())
    }

    pub fn disconnect(&self, connection_id: &str) {
        if let Some(tx) = self.conns.lock().remove(connection_id) {
            let _ = tx.send(SftpRequest::Close);
        }
    }

    pub fn list(&self, id: &str, path: &str) -> AppResult<Vec<FileEntry>> {
        self.request(id, |reply| SftpRequest::List(path.to_string(), reply))
    }

    pub fn realpath(&self, id: &str, path: &str) -> AppResult<String> {
        self.request(id, |reply| SftpRequest::Realpath(path.to_string(), reply))
    }

    pub fn mkdir(&self, id: &str, path: &str) -> AppResult<()> {
        self.request(id, |reply| SftpRequest::Mkdir(path.to_string(), reply))
    }

    pub fn rename(&self, id: &str, from: &str, to: &str) -> AppResult<()> {
        self.request(id, |reply| {
            SftpRequest::Rename(from.to_string(), to.to_string(), reply)
        })
    }

    pub fn remove(&self, id: &str, path: &str, is_dir: bool) -> AppResult<()> {
        self.request(id, |reply| SftpRequest::Remove {
            path: path.to_string(),
            is_dir,
            reply,
        })
    }

    fn download(
        &self,
        id: &str,
        remote: &str,
        local: PathBuf,
        progress: ProgressCtx,
    ) -> AppResult<()> {
        self.request(id, |reply| SftpRequest::Download {
            remote: remote.to_string(),
            local,
            progress,
            reply,
        })
    }

    fn upload(
        &self,
        id: &str,
        local: PathBuf,
        remote: &str,
        progress: ProgressCtx,
    ) -> AppResult<()> {
        self.request(id, |reply| SftpRequest::Upload {
            local,
            remote: remote.to_string(),
            progress,
            reply,
        })
    }

    fn exec(&self, id: &str, command: &str) -> AppResult<String> {
        self.request(id, |reply| SftpRequest::Exec {
            command: command.to_string(),
            reply,
        })
    }

    /// Send a request to a connection's worker and block for its reply.
    fn request<T>(
        &self,
        id: &str,
        make: impl FnOnce(Sender<AppResult<T>>) -> SftpRequest,
    ) -> AppResult<T> {
        let tx = {
            let conns = self.conns.lock();
            conns
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(format!("sftp connection {id}")))?
        };
        let (reply_tx, reply_rx) = mpsc::channel::<AppResult<T>>();
        tx.send(make(reply_tx))
            .map_err(|_| AppError::Other("sftp connection is no longer running".into()))?;
        reply_rx
            .recv()
            .map_err(|_| AppError::Other("sftp connection dropped the request".into()))?
    }
}

fn emit_status(app: &AppHandle, id: &str, status: &str) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            connection_id: id.to_string(),
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
            connection_id: id.to_string(),
            status: "error".to_string(),
            message: Some(err.to_string()),
            code: Some(err.code().to_string()),
        },
    );
}

fn is_connection_lost_error(err: &AppError) -> bool {
    matches!(err, AppError::Other(message) if message.starts_with("connection lost:"))
}

fn send_reply<T>(
    app: &AppHandle,
    id: &str,
    reply: Sender<AppResult<T>>,
    result: AppResult<T>,
) -> bool {
    let fatal = result
        .as_ref()
        .err()
        .filter(|err| is_connection_lost_error(err))
        .map(|err| AppError::Other(err.to_string()));
    if let Some(err) = &fatal {
        emit_error_status(app, id, err);
    }
    let _ = reply.send(result);
    fatal.is_some()
}

fn map_remote_io_error(e: io::Error) -> AppError {
    match e.kind() {
        io::ErrorKind::TimedOut
        | io::ErrorKind::ConnectionAborted
        | io::ErrorKind::ConnectionReset
        | io::ErrorKind::BrokenPipe
        | io::ErrorKind::UnexpectedEof => connection_lost(e),
        io::ErrorKind::Other => {
            let message = e.to_string();
            if message.contains("transport read")
                || message.contains("draining incoming flow")
                || message.contains("socket")
            {
                connection_lost(message)
            } else {
                AppError::Io(io::Error::other(message))
            }
        }
        _ => AppError::Io(e),
    }
}

fn map_stream_error(e: io::Error, remote: bool) -> AppError {
    if remote {
        map_remote_io_error(e)
    } else {
        AppError::Io(e)
    }
}

/// Worker thread entry point: establish the session, then serve requests until
/// closed or the channel disconnects.
fn run_connection(app: AppHandle, params: SftpConnectParams, rx: Receiver<SftpRequest>) {
    let id = params.connection_id.clone();
    emit_status(&app, &id, "connecting");

    let (session, sftp) = match open_sftp(&params) {
        Ok(pair) => pair,
        Err(e) => {
            emit_error_status(&app, &id, &e);
            return;
        }
    };

    emit_status(&app, &id, "connected");

    let mut clean_close = true;
    loop {
        let req = match rx.recv_timeout(KEEPALIVE_INTERVAL) {
            Ok(req) => req,
            Err(RecvTimeoutError::Timeout) => {
                match session.keepalive_send() {
                    Ok(_) => {}
                    Err(ref e) if is_ssh_would_block(e) => {}
                    Err(e) => {
                        let err = connection_lost(e);
                        emit_error_status(&app, &id, &err);
                        clean_close = false;
                        break;
                    }
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        };

        let fatal = match req {
            SftpRequest::List(path, reply) => send_reply(&app, &id, reply, list_dir(&sftp, &path)),
            SftpRequest::Realpath(path, reply) => send_reply(
                &app,
                &id,
                reply,
                sftp.realpath(Path::new(&path))
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(map_ssh_error),
            ),
            SftpRequest::Mkdir(path, reply) => send_reply(
                &app,
                &id,
                reply,
                sftp.mkdir(Path::new(&path), 0o755).map_err(map_ssh_error),
            ),
            SftpRequest::Rename(from, to, reply) => send_reply(
                &app,
                &id,
                reply,
                sftp.rename(Path::new(&from), Path::new(&to), None)
                    .map_err(map_ssh_error),
            ),
            SftpRequest::Remove {
                path,
                is_dir,
                reply,
            } => send_reply(
                &app,
                &id,
                reply,
                remove_path(&sftp, Path::new(&path), is_dir),
            ),
            SftpRequest::Download {
                remote,
                local,
                progress,
                reply,
            } => send_reply(
                &app,
                &id,
                reply,
                download(&app, &sftp, &remote, &local, &progress),
            ),
            SftpRequest::Upload {
                local,
                remote,
                progress,
                reply,
            } => send_reply(
                &app,
                &id,
                reply,
                upload(&app, &sftp, &local, &remote, &progress),
            ),
            SftpRequest::Exec { command, reply } => {
                send_reply(&app, &id, reply, exec_command(&session, &command))
            }
            SftpRequest::Close => break,
        };

        if fatal {
            clean_close = false;
            break;
        }
    }

    if clean_close {
        emit_status(&app, &id, "closed");
    }
}

fn open_sftp(params: &SftpConnectParams) -> AppResult<(ssh2::Session, ssh2::Sftp)> {
    let tcp = connect_tcp(&params.host, params.port)?;
    let mut session = ssh2::Session::new()?;
    session.set_tcp_stream(tcp);
    session.set_timeout(CONNECT_TIMEOUT.as_millis() as u32);
    session.handshake().map_err(map_ssh_error)?;
    authenticate(&session, &params.username, &params.auth)?;
    let sftp = session.sftp().map_err(map_ssh_error)?;
    session.set_keepalive(false, KEEPALIVE_INTERVAL.as_secs() as u32);
    session.set_timeout(0);
    Ok((session, sftp))
}

/// Run `command` on an exec channel, returning its stdout. A non-zero exit
/// status maps to an error carrying the command's stderr.
fn exec_command(session: &ssh2::Session, command: &str) -> AppResult<String> {
    let mut channel = session.channel_session().map_err(map_ssh_error)?;
    channel.exec(command).map_err(map_ssh_error)?;
    let mut stdout = String::new();
    channel
        .read_to_string(&mut stdout)
        .map_err(map_remote_io_error)?;
    let mut stderr = String::new();
    channel
        .stderr()
        .read_to_string(&mut stderr)
        .map_err(map_remote_io_error)?;
    channel.wait_close().map_err(map_ssh_error)?;
    let code = channel.exit_status().map_err(map_ssh_error)?;
    if code != 0 {
        let detail = stderr.trim();
        let detail = if detail.is_empty() {
            "no output"
        } else {
            detail
        };
        return Err(AppError::Other(format!(
            "remote command failed (exit {code}): {detail}"
        )));
    }
    Ok(stdout)
}

/// Remove a remote path. Directories are emptied recursively first, since SFTP's
/// `rmdir` only succeeds on an empty directory (mirroring local `remove_dir_all`).
fn remove_path(sftp: &ssh2::Sftp, path: &Path, is_dir: bool) -> AppResult<()> {
    if !is_dir {
        return sftp.unlink(path).map_err(map_ssh_error);
    }
    for (child, stat) in sftp.readdir(path).map_err(map_ssh_error)? {
        let name = child.file_name().and_then(|n| n.to_str());
        // `readdir` does not include "." / ".."; guard anyway.
        if matches!(name, Some(".") | Some("..")) {
            continue;
        }
        // Never recurse into a symlink to a directory: unlink the link itself.
        let is_symlink = stat.perm.map(|p| p & 0o170000 == 0o120000).unwrap_or(false);
        let child_is_dir = stat.is_dir() && !is_symlink;
        remove_path(sftp, &child, child_is_dir)?;
    }
    sftp.rmdir(path).map_err(map_ssh_error)
}

fn list_dir(sftp: &ssh2::Sftp, path: &str) -> AppResult<Vec<FileEntry>> {
    let base = Path::new(path);
    let mut entries = Vec::new();
    for (child, stat) in sftp.readdir(base).map_err(map_ssh_error)? {
        let name = child
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        entries.push(file_entry(name, &child, &stat));
    }
    sort_entries(&mut entries);
    Ok(entries)
}

fn file_entry(name: String, path: &Path, stat: &ssh2::FileStat) -> FileEntry {
    let perm = stat.perm;
    let is_symlink = perm.map(|p| p & 0o170000 == 0o120000).unwrap_or(false);
    let kind = if is_symlink {
        "symlink"
    } else if stat.is_dir() {
        "dir"
    } else {
        "file"
    };
    FileEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        size: stat.size.unwrap_or(0),
        modified: stat.mtime.map(|m| m as i64),
        permissions: perm,
        is_symlink,
    }
}

fn download(
    app: &AppHandle,
    sftp: &ssh2::Sftp,
    remote: &str,
    local: &Path,
    progress: &ProgressCtx,
) -> AppResult<()> {
    let mut remote_file = sftp.open(Path::new(remote)).map_err(map_ssh_error)?;
    let mut local_file = fs::File::create(local)?;
    stream(
        app,
        &mut remote_file,
        true,
        &mut local_file,
        false,
        progress,
    )
}

fn upload(
    app: &AppHandle,
    sftp: &ssh2::Sftp,
    local: &Path,
    remote: &str,
    progress: &ProgressCtx,
) -> AppResult<()> {
    let mut local_file = fs::File::open(local)?;
    let mut remote_file = sftp.create(Path::new(remote)).map_err(map_ssh_error)?;
    stream(
        app,
        &mut local_file,
        false,
        &mut remote_file,
        true,
        progress,
    )
}

/// Copy `reader` → `writer` in chunks, emitting `sftp://transfer` progress.
fn stream(
    app: &AppHandle,
    reader: &mut impl Read,
    remote_reader: bool,
    writer: &mut impl Write,
    remote_writer: bool,
    progress: &ProgressCtx,
) -> AppResult<()> {
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut done = progress.base;
    loop {
        if progress.cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let n = reader
            .read(&mut buf)
            .map_err(|e| map_stream_error(e, remote_reader))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| map_stream_error(e, remote_writer))?;
        done += n as u64;
        if !progress.silent {
            emit_transfer(app, progress, done, "active", None);
        }
    }
    writer
        .flush()
        .map_err(|e| map_stream_error(e, remote_writer))?;
    Ok(())
}

fn emit_transfer(
    app: &AppHandle,
    progress: &ProgressCtx,
    done: u64,
    status: &str,
    message: Option<String>,
) {
    emit_xfer(
        app,
        &progress.transfer_id,
        done,
        progress.total,
        &progress.label,
        status,
        progress.phase.clone(),
        message,
    );
}

/// Low-level transfer-event emitter with every field spelled out, so the
/// compressed-transfer phases (which have no [`ProgressCtx`]) can report too.
#[allow(clippy::too_many_arguments)]
fn emit_xfer(
    app: &AppHandle,
    transfer_id: &str,
    transferred: u64,
    total: u64,
    file: &str,
    status: &str,
    phase: Option<String>,
    message: Option<String>,
) {
    let _ = app.emit(
        EVENT_TRANSFER,
        TransferEvent {
            transfer_id: transfer_id.to_string(),
            transferred,
            total,
            file: file.to_string(),
            status: status.to_string(),
            phase,
            message,
        },
    );
}

// --- Local filesystem helpers (no SSH; run on the command's blocking task) ---

/// List a local directory into the same [`FileEntry`] shape used for remote.
pub fn local_list(path: &str) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_type = entry.file_type()?;
        let is_symlink = file_type.is_symlink();
        let kind = if is_symlink {
            "symlink"
        } else if meta.is_dir() {
            "dir"
        } else {
            "file"
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            Some(meta.permissions().mode())
        };
        #[cfg(not(unix))]
        let permissions = None;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            kind: kind.to_string(),
            size: meta.len(),
            modified,
            permissions,
            is_symlink,
        });
    }
    sort_entries(&mut entries);
    Ok(entries)
}

/// Directories first, then case-insensitive name order.
fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        let a_dir = a.kind == "dir";
        let b_dir = b.kind == "dir";
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

// --- Transfer orchestration (called from the command layer) ---

/// One end of a transfer: a local path (`connection_id == None`) or a path on a
/// remote connection.
pub struct Endpoint {
    pub connection_id: Option<String>,
    pub path: String,
}

/// Compute the total byte size of a transfer source (recursing into dirs) so
/// the UI can show an accurate progress denominator.
fn source_size(mgr: &SftpManager, ep: &Endpoint) -> AppResult<u64> {
    match &ep.connection_id {
        None => local_size(Path::new(&ep.path)),
        Some(id) => remote_size(mgr, id, &ep.path),
    }
}

fn local_size(path: &Path) -> AppResult<u64> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() {
        let mut total = 0;
        for entry in fs::read_dir(path)? {
            total += local_size(&entry?.path())?;
        }
        Ok(total)
    } else {
        Ok(meta.len())
    }
}

fn remote_size(mgr: &SftpManager, id: &str, path: &str) -> AppResult<u64> {
    let mut total = 0;
    for entry in mgr.list(id, path)? {
        if entry.kind == "dir" {
            total += remote_size(mgr, id, &entry.path)?;
        } else {
            total += entry.size;
        }
    }
    Ok(total)
}

/// Join a remote/posix-style directory with a child name.
fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// Transfer `source` into directory `dest_dir`, preserving the source's base
/// name. Handles file or directory (recursive) sources across any combination
/// of local/remote endpoints, emitting progress under `transfer_id`.
///
/// When `compress` is set and the source is a directory crossing the network,
/// the tree is bundled into a single `tar.gz`, sent as one file, and unpacked
/// at the destination — far faster than per-file SFTP round-trips for many
/// small files. See [`transfer_compressed`].
///
/// `cancel` is checked between chunks/files; when set, the transfer stops and
/// reports a `"cancelled"` outcome instead of `"error"`.
pub fn transfer(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    source: &Endpoint,
    dest_dir: &Endpoint,
    compress: bool,
    cancel: Arc<AtomicBool>,
) -> TransferOutcome {
    // Compression only pays off for a directory that actually crosses the
    // network; a local→local copy gains nothing from archiving.
    let crosses_network = source.connection_id.is_some() || dest_dir.connection_id.is_some();
    let name = base_name(&source.path);
    if let Err(e) = validate_transfer_target(mgr, source, dest_dir, &name) {
        emit_xfer(
            app,
            transfer_id,
            0,
            0,
            &name,
            "error",
            None,
            Some(e.to_string()),
        );
        return TransferOutcome {
            transferred: 0,
            total: 0,
            status: "error",
            message: Some(e.to_string()),
        };
    }
    if compress && crosses_network && is_dir(mgr, source).unwrap_or(false) {
        return transfer_compressed(app, mgr, transfer_id, source, dest_dir, cancel);
    }

    let total = source_size(mgr, source).unwrap_or(0);
    let progress = ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: name.clone(),
        silent: false,
        phase: None,
        cancel,
    };

    let mut done = 0u64;
    let result = transfer_node(app, mgr, source, dest_dir, &name, &progress, &mut done);
    match result {
        Ok(()) => {
            emit_transfer(app, &progress_at(&progress, &name), total, "done", None);
            TransferOutcome {
                transferred: total,
                total,
                status: "done",
                message: None,
            }
        }
        Err(AppError::Cancelled) => {
            emit_transfer(app, &progress_at(&progress, &name), done, "cancelled", None);
            TransferOutcome {
                transferred: done,
                total,
                status: "cancelled",
                message: None,
            }
        }
        Err(e) => {
            emit_transfer(
                app,
                &progress_at(&progress, &name),
                done,
                "error",
                Some(e.to_string()),
            );
            TransferOutcome {
                transferred: done,
                total,
                status: "error",
                message: Some(e.to_string()),
            }
        }
    }
}

fn progress_at(p: &ProgressCtx, label: &str) -> ProgressCtx {
    ProgressCtx {
        label: label.to_string(),
        ..p.clone()
    }
}

/// Recursively transfer one node (file or dir) named `name` into `dest_dir`.
/// `done` accumulates transferred bytes across the whole operation.
fn transfer_node(
    app: &AppHandle,
    mgr: &SftpManager,
    source: &Endpoint,
    dest_dir: &Endpoint,
    name: &str,
    progress: &ProgressCtx,
    done: &mut u64,
) -> AppResult<()> {
    if progress.cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }
    let dest_path = dest_join(dest_dir, name);

    if is_dir(mgr, source)? {
        // Create the destination directory, then copy children.
        make_dir(mgr, dest_dir, name)?;
        let dest_child = Endpoint {
            connection_id: dest_dir.connection_id.clone(),
            path: dest_path,
        };
        for child in list(mgr, source)? {
            let child_src = Endpoint {
                connection_id: source.connection_id.clone(),
                path: child.path,
            };
            transfer_node(
                app,
                mgr,
                &child_src,
                &dest_child,
                &child.name,
                progress,
                done,
            )?;
        }
        Ok(())
    } else {
        let dest = Endpoint {
            connection_id: dest_dir.connection_id.clone(),
            path: dest_path,
        };
        copy_file(app, mgr, source, &dest, progress, done, name)
    }
}

/// Copy a single file between any combination of local/remote endpoints,
/// emitting progress that resumes from the accumulated `done` byte count.
fn copy_file(
    app: &AppHandle,
    mgr: &SftpManager,
    source: &Endpoint,
    dest: &Endpoint,
    progress: &ProgressCtx,
    done: &mut u64,
    label: &str,
) -> AppResult<()> {
    let size = file_size(mgr, source)?;
    let file_progress = ProgressCtx {
        base: *done,
        label: label.to_string(),
        ..progress.clone()
    };

    match (&source.connection_id, &dest.connection_id) {
        // local → local
        (None, None) => {
            let mut reader = fs::File::open(&source.path)?;
            let mut writer = fs::File::create(&dest.path)?;
            stream(app, &mut reader, false, &mut writer, false, &file_progress)?;
        }
        // local → remote (worker uploads and emits progress)
        (None, Some(dest_id)) => {
            mgr.upload(
                dest_id,
                PathBuf::from(&source.path),
                &dest.path,
                file_progress,
            )?;
        }
        // remote → local (worker downloads and emits progress)
        (Some(src_id), None) => {
            mgr.download(
                src_id,
                &source.path,
                PathBuf::from(&dest.path),
                file_progress,
            )?;
        }
        // remote → remote: bridge through a local temp file. The download half
        // emits progress; the upload half is silent so bytes count once.
        (Some(src_id), Some(dest_id)) => {
            let tmp =
                std::env::temp_dir().join(format!("sageport-{}-{}", uuid::Uuid::new_v4(), label));
            mgr.download(src_id, &source.path, tmp.clone(), file_progress.clone())?;
            let upload_progress = ProgressCtx {
                silent: true,
                ..file_progress
            };
            let res = mgr.upload(dest_id, tmp.clone(), &dest.path, upload_progress);
            let _ = fs::remove_file(&tmp);
            res?;
        }
    }

    *done += size;
    Ok(())
}

// --- small endpoint helpers ---

fn validate_transfer_target(
    mgr: &SftpManager,
    source: &Endpoint,
    dest_dir: &Endpoint,
    name: &str,
) -> AppResult<()> {
    if source.connection_id != dest_dir.connection_id {
        return Ok(());
    }

    let source_is_dir = is_dir(mgr, source)?;
    match &source.connection_id {
        None => {
            let source_path = normalize_local_path(Path::new(&source.path));
            let target_path = normalize_local_path(Path::new(&dest_dir.path)).join(name);
            let target_path = clean_local_path(&target_path);
            if source_path == target_path {
                return Err(AppError::Invalid(
                    "cannot copy a file or folder onto itself".into(),
                ));
            }
            if source_is_dir && target_path.starts_with(&source_path) {
                return Err(AppError::Invalid(
                    "cannot copy a folder into itself or one of its subfolders".into(),
                ));
            }
        }
        Some(_) => {
            let source_path = normalize_remote_path(&source.path);
            let target_path = normalize_remote_path(&join_remote(&dest_dir.path, name));
            if source_path == target_path {
                return Err(AppError::Invalid(
                    "cannot copy a file or folder onto itself".into(),
                ));
            }
            if source_is_dir && remote_is_child_path(&source_path, &target_path) {
                return Err(AppError::Invalid(
                    "cannot copy a folder into itself or one of its subfolders".into(),
                ));
            }
        }
    }
    Ok(())
}

fn normalize_local_path(path: &Path) -> PathBuf {
    let absolute = fs::canonicalize(path).unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(path)
        }
    });
    clean_local_path(&absolute)
}

fn clean_local_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                out.push(component.as_os_str());
            }
        }
    }
    out
}

fn normalize_remote_path(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    let body = parts.join("/");
    if absolute {
        if body.is_empty() {
            "/".to_string()
        } else {
            format!("/{body}")
        }
    } else if body.is_empty() {
        ".".to_string()
    } else {
        body
    }
}

fn remote_is_child_path(parent: &str, child: &str) -> bool {
    if parent == "/" {
        return child != "/";
    }
    child
        .strip_prefix(parent)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Size of a single file at `ep` (0 if it cannot be determined).
fn file_size(mgr: &SftpManager, ep: &Endpoint) -> AppResult<u64> {
    match &ep.connection_id {
        None => Ok(fs::symlink_metadata(&ep.path)?.len()),
        Some(id) => {
            let name = base_name(&ep.path);
            let parent = parent_remote(&ep.path);
            for e in mgr.list(id, &parent)? {
                if e.name == name {
                    return Ok(e.size);
                }
            }
            Ok(0)
        }
    }
}

fn is_dir(mgr: &SftpManager, ep: &Endpoint) -> AppResult<bool> {
    match &ep.connection_id {
        None => Ok(fs::symlink_metadata(&ep.path)?.is_dir()),
        Some(id) => {
            // Determine via parent listing.
            let name = base_name(&ep.path);
            let parent = parent_remote(&ep.path);
            for e in mgr.list(id, &parent)? {
                if e.name == name {
                    return Ok(e.kind == "dir");
                }
            }
            Ok(false)
        }
    }
}

fn list(mgr: &SftpManager, ep: &Endpoint) -> AppResult<Vec<FileEntry>> {
    match &ep.connection_id {
        None => local_list(&ep.path),
        Some(id) => mgr.list(id, &ep.path),
    }
}

fn make_dir(mgr: &SftpManager, dest_dir: &Endpoint, name: &str) -> AppResult<()> {
    let path = dest_join(dest_dir, name);
    match &dest_dir.connection_id {
        None => {
            fs::create_dir_all(&path)?;
            Ok(())
        }
        Some(id) => {
            // Ignore "already exists" by checking first.
            if mgr.list(id, &path).is_ok() {
                return Ok(());
            }
            mgr.mkdir(id, &path)
        }
    }
}

fn dest_join(dest_dir: &Endpoint, name: &str) -> String {
    match &dest_dir.connection_id {
        None => Path::new(&dest_dir.path)
            .join(name)
            .to_string_lossy()
            .into_owned(),
        Some(_) => join_remote(&dest_dir.path, name),
    }
}

pub(crate) fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

fn parent_remote(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(i) => trimmed[..i].to_string(),
        None => ".".to_string(),
    }
}

// --- Compressed (tar.gz) directory transfers ---

const PHASE_COMPRESS: &str = "compressing";
const PHASE_TRANSFER: &str = "transferring";
const PHASE_EXTRACT: &str = "extracting";

/// Bundle the directory at `source` into a single `tar.gz`, ship it as one file,
/// and unpack it into `dest_dir`. Emits the same `sftp://transfer` events as a
/// plain copy, but tagged with a `phase` so the UI can show compress/transfer/
/// extract progress. The archive is rooted at the source's base name, so it
/// expands to `dest_dir/<name>/…`, matching plain-copy semantics.
fn transfer_compressed(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    source: &Endpoint,
    dest_dir: &Endpoint,
    cancel: Arc<AtomicBool>,
) -> TransferOutcome {
    let name = base_name(&source.path);
    let emit =
        |transferred: u64, total: u64, status: &str, phase: Option<&str>, msg: Option<String>| {
            emit_xfer(
                app,
                transfer_id,
                transferred,
                total,
                &name,
                status,
                phase.map(str::to_string),
                msg,
            );
        };

    if cancel.load(Ordering::Relaxed) {
        emit(0, 0, "cancelled", None, None);
        return TransferOutcome {
            transferred: 0,
            total: 0,
            status: "cancelled",
            message: None,
        };
    }

    emit(0, 0, "active", Some(PHASE_COMPRESS), None);

    let result: AppResult<u64> = match (&source.connection_id, &dest_dir.connection_id) {
        (None, Some(dst)) => compressed_local_to_remote(
            app,
            mgr,
            transfer_id,
            &name,
            &source.path,
            dst,
            &dest_dir.path,
            cancel,
        ),
        (Some(src), None) => compressed_remote_to_local(
            app,
            mgr,
            transfer_id,
            &name,
            src,
            &source.path,
            &dest_dir.path,
            cancel,
        ),
        (Some(src), Some(dst)) => compressed_remote_to_remote(
            app,
            mgr,
            transfer_id,
            &name,
            src,
            &source.path,
            dst,
            &dest_dir.path,
            cancel,
        ),
        // local→local is filtered out by the caller; nothing to compress.
        (None, None) => Ok(0),
    };

    match result {
        Ok(size) => {
            emit(size, size, "done", None, None);
            TransferOutcome {
                transferred: size,
                total: size,
                status: "done",
                message: None,
            }
        }
        Err(AppError::Cancelled) => {
            emit(0, 0, "cancelled", None, None);
            TransferOutcome {
                transferred: 0,
                total: 0,
                status: "cancelled",
                message: None,
            }
        }
        Err(e) => {
            emit(0, 0, "error", None, Some(e.to_string()));
            TransferOutcome {
                transferred: 0,
                total: 0,
                status: "error",
                message: Some(e.to_string()),
            }
        }
    }
}

/// Build the local→remote `ProgressCtx` for the single-archive transfer phase.
fn xfer_progress(
    transfer_id: &str,
    label: &str,
    total: u64,
    silent: bool,
    cancel: Arc<AtomicBool>,
) -> ProgressCtx {
    ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: label.to_string(),
        silent,
        phase: Some(PHASE_TRANSFER.to_string()),
        cancel,
    }
}

#[allow(clippy::too_many_arguments)]
fn compressed_local_to_remote(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_path: &str,
    dst_id: &str,
    dst_dir: &str,
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let tmp = local_temp_archive();
    create_local_archive(Path::new(src_path), &tmp)?;
    let size = fs::metadata(&tmp)?.len();

    let remote_archive = join_remote(dst_dir, &remote_archive_name());
    let res = (|| -> AppResult<()> {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let progress = xfer_progress(transfer_id, name, size, false, cancel.clone());
        mgr.upload(dst_id, tmp.clone(), &remote_archive, progress)?;

        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        emit_xfer(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
        );
        let cmd = format!(
            "tar -xzf {} -C {}",
            sh_quote(&remote_archive),
            sh_quote(dst_dir)
        );
        mgr.exec(dst_id, &cmd)?;
        Ok(())
    })();

    let _ = mgr.exec(dst_id, &format!("rm -f {}", sh_quote(&remote_archive)));
    let _ = fs::remove_file(&tmp);
    res.map(|()| size)
}

#[allow(clippy::too_many_arguments)]
fn compressed_remote_to_local(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_id: &str,
    src_path: &str,
    dst_dir: &str,
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let remote_archive = remote_temp_archive();
    let pack = format!(
        "tar -czf {} -C {} {}",
        sh_quote(&remote_archive),
        sh_quote(&parent),
        sh_quote(name)
    );
    mgr.exec(src_id, &pack)?;

    let tmp = local_temp_archive();
    let res = (|| -> AppResult<u64> {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let size = remote_file_size(mgr, src_id, &remote_archive)?;
        let progress = xfer_progress(transfer_id, name, size, false, cancel.clone());
        mgr.download(src_id, &remote_archive, tmp.clone(), progress)?;

        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        emit_xfer(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
        );
        extract_local_archive(&tmp, Path::new(dst_dir))?;
        Ok(size)
    })();

    let _ = mgr.exec(src_id, &format!("rm -f {}", sh_quote(&remote_archive)));
    let _ = fs::remove_file(&tmp);
    res
}

#[allow(clippy::too_many_arguments)]
fn compressed_remote_to_remote(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_id: &str,
    src_path: &str,
    dst_id: &str,
    dst_dir: &str,
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let src_archive = remote_temp_archive();
    let pack = format!(
        "tar -czf {} -C {} {}",
        sh_quote(&src_archive),
        sh_quote(&parent),
        sh_quote(name)
    );
    mgr.exec(src_id, &pack)?;

    let tmp = local_temp_archive();
    let dst_archive = join_remote(dst_dir, &remote_archive_name());
    let res = (|| -> AppResult<u64> {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        // Bridge the archive through a local temp file: the download half shows
        // progress, the upload half is silent so bytes count once.
        let size = remote_file_size(mgr, src_id, &src_archive)?;
        mgr.download(
            src_id,
            &src_archive,
            tmp.clone(),
            xfer_progress(transfer_id, name, size, false, cancel.clone()),
        )?;
        mgr.upload(
            dst_id,
            tmp.clone(),
            &dst_archive,
            xfer_progress(transfer_id, name, size, true, cancel.clone()),
        )?;

        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        emit_xfer(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
        );
        let unpack = format!(
            "tar -xzf {} -C {}",
            sh_quote(&dst_archive),
            sh_quote(dst_dir)
        );
        mgr.exec(dst_id, &unpack)?;
        Ok(size)
    })();

    let _ = mgr.exec(src_id, &format!("rm -f {}", sh_quote(&src_archive)));
    let _ = mgr.exec(dst_id, &format!("rm -f {}", sh_quote(&dst_archive)));
    let _ = fs::remove_file(&tmp);
    res
}

/// Create a gzip-compressed tar of `src_dir`, rooted at the directory's own
/// name so it unpacks as `<dest>/<name>/…`.
fn create_local_archive(src_dir: &Path, archive: &Path) -> AppResult<()> {
    let name = src_dir
        .file_name()
        .map(|n| n.to_owned())
        .ok_or_else(|| AppError::Other("source has no directory name".into()))?;
    let file = fs::File::create(archive)?;
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    builder.append_dir_all(&name, src_dir)?;
    builder.into_inner()?.finish()?;
    Ok(())
}

fn extract_local_archive(archive: &Path, dest_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(dest_dir)?;
    let file = fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    tar::Archive::new(decoder).unpack(dest_dir)?;
    Ok(())
}

/// Byte size of a remote file via a portable `wc -c` (avoids `stat`'s differing
/// GNU/BSD flags). Returns 0 if it cannot be parsed.
fn remote_file_size(mgr: &SftpManager, id: &str, path: &str) -> AppResult<u64> {
    let out = mgr.exec(id, &format!("wc -c < {}", sh_quote(path)))?;
    Ok(out.trim().parse().unwrap_or(0))
}

fn local_temp_archive() -> PathBuf {
    std::env::temp_dir().join(format!("sageport-{}.tar.gz", uuid::Uuid::new_v4()))
}

/// A remote scratch archive under `/tmp` (writable on essentially every Unix
/// host, regardless of the source/destination directory's permissions).
fn remote_temp_archive() -> String {
    format!("/tmp/sageport-{}.tar.gz", uuid::Uuid::new_v4())
}

/// A hidden archive basename to drop inside the destination directory itself
/// (guaranteed writable, since we are extracting there).
fn remote_archive_name() -> String {
    format!(".sageport-{}.tar.gz", uuid::Uuid::new_v4())
}

/// Single-quote a string for safe interpolation into a `/bin/sh` command.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_path_normalization_preserves_root_boundaries() {
        assert_eq!(normalize_remote_path("/srv/app/../app/."), "/srv/app");
        assert!(remote_is_child_path("/srv/app", "/srv/app/logs"));
        assert!(!remote_is_child_path("/srv/app", "/srv/application"));
        assert!(!remote_is_child_path("/srv/app", "/srv/app"));
    }

    #[test]
    fn local_path_cleaning_removes_dot_segments() {
        let cleaned = clean_local_path(Path::new("/tmp/sageport/../sageport/./file"));
        assert!(cleaned.ends_with(Path::new("sageport/file")));
    }
}
