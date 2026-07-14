use std::collections::HashMap;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use parking_lot::Mutex;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use super::connect::{establish, SshConnection};
use super::{ConnectParams, ConnectionPrompts, EVENT_DATA, EVENT_STATUS, TERM};
use crate::error::{AppError, AppResult};

type ConnectionMap = Arc<Mutex<HashMap<String, Arc<SshConnection>>>>;

enum SessionCommand {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct SessionEntry {
    tx: UnboundedSender<SessionCommand>,
    attempt: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataEvent {
    id: String,
    attempt: u32,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    id: String,
    attempt: u32,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    connections: ConnectionMap,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn connection(&self, id: &str) -> Option<Arc<SshConnection>> {
        self.connections.lock().get(id).cloned()
    }

    pub fn connect(&self, app: AppHandle, prompts: ConnectionPrompts, params: ConnectParams) {
        let id = params.session_id.clone();
        let attempt = params.attempt;
        let (tx, rx) = mpsc::unbounded_channel();

        let previous = {
            let mut sessions = self.sessions.lock();
            if sessions
                .get(&id)
                .is_some_and(|entry| entry.attempt == attempt)
            {
                return;
            }
            sessions.insert(id.clone(), SessionEntry { tx, attempt })
        };
        if let Some(entry) = previous {
            let _ = entry.tx.send(SessionCommand::Close);
        }

        let sessions = self.sessions.clone();
        let connections = self.connections.clone();
        tokio::spawn(async move {
            run_session(app, prompts, params, rx, connections.clone()).await;
            connections.lock().remove(&id);
            let mut sessions = sessions.lock();
            if sessions
                .get(&id)
                .is_some_and(|entry| entry.attempt == attempt)
            {
                sessions.remove(&id);
            }
        });
    }

    pub fn send_input(&self, id: &str, data: Vec<u8>) -> AppResult<()> {
        self.dispatch(id, SessionCommand::Input(data))
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> AppResult<()> {
        self.dispatch(id, SessionCommand::Resize(cols, rows))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        if let Some(entry) = self.sessions.lock().remove(id) {
            let _ = entry.tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    pub fn close_all(&self) {
        for (_, entry) in self.sessions.lock().drain() {
            let _ = entry.tx.send(SessionCommand::Close);
        }
    }

    fn dispatch(&self, id: &str, cmd: SessionCommand) -> AppResult<()> {
        let sessions = self.sessions.lock();
        let entry = sessions
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        entry
            .tx
            .send(cmd)
            .map_err(|_| AppError::Other("session is no longer running".into()))
    }
}

fn emit_status(app: &AppHandle, id: &str, attempt: u32, status: &str, err: Option<&AppError>) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            id: id.to_string(),
            attempt,
            status: status.to_string(),
            message: err.map(|e| e.to_string()),
            code: err.map(|e| e.code().to_string()),
        },
    );
}

async fn run_session(
    app: AppHandle,
    prompts: ConnectionPrompts,
    params: ConnectParams,
    rx: UnboundedReceiver<SessionCommand>,
    connections: ConnectionMap,
) {
    let id = params.session_id.clone();
    let attempt = params.attempt;
    emit_status(&app, &id, attempt, "connecting", None);

    match run_session_inner(&app, &prompts, &params, rx, &connections).await {
        Ok(()) => emit_status(&app, &id, attempt, "closed", None),
        Err(e) => emit_status(&app, &id, attempt, "error", Some(&e)),
    }
}

async fn run_session_inner(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    params: &ConnectParams,
    mut rx: UnboundedReceiver<SessionCommand>,
    connections: &ConnectionMap,
) -> AppResult<()> {
    let id = &params.session_id;
    let attempt = params.attempt;

    let conn = tokio::select! {
        result = establish(app, prompts, id, &params.hops) => Arc::new(result?),
        _ = wait_close(&mut rx) => return Ok(()),
    };
    let mut channel = conn.handle.channel_open_session().await?;
    channel
        .request_pty(false, TERM, params.cols, params.rows, 0, 0, &[])
        .await?;
    channel.request_shell(true).await?;

    connections.lock().insert(id.clone(), conn.clone());
    emit_status(app, id, attempt, "connected", None);

    if let Some(command) = &params.startup_command {
        if !command.trim().is_empty() {
            let line = format!("{command}\n");
            let _ = channel.data(line.as_bytes()).await;
        }
    }

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => emit_data(app, id, attempt, &data),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_data(app, id, attempt, &data),
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
            cmd = rx.recv() => {
                match cmd {
                    Some(SessionCommand::Input(data)) => {
                        channel.data(&data[..]).await?;
                    }
                    Some(SessionCommand::Resize(cols, rows)) => {
                        channel.window_change(cols, rows, 0, 0).await?;
                    }
                    Some(SessionCommand::Close) | None => break,
                }
            }
        }
    }

    connections.lock().remove(id);
    drop(conn);
    Ok(())
}

async fn wait_close(rx: &mut UnboundedReceiver<SessionCommand>) {
    loop {
        match rx.recv().await {
            Some(SessionCommand::Close) | None => return,
            Some(_) => {}
        }
    }
}

fn emit_data(app: &AppHandle, id: &str, attempt: u32, data: &[u8]) {
    let _ = app.emit(
        EVENT_DATA,
        DataEvent {
            id: id.to_string(),
            attempt,
            data: STANDARD.encode(data),
        },
    );
}
