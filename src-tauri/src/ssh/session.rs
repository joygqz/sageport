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

struct ConnectionEntry {
    attempt: u32,
    connection: Arc<SshConnection>,
}

type ConnectionMap = Arc<Mutex<HashMap<String, ConnectionEntry>>>;

enum SessionCommand {
    Input(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct SessionEntry {
    tx: UnboundedSender<SessionCommand>,
    attempt: u32,
}

pub struct SessionReservation {
    id: String,
    attempt: u32,
    rx: UnboundedReceiver<SessionCommand>,
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
        self.connections
            .lock()
            .get(id)
            .map(|entry| entry.connection.clone())
    }

    pub fn reserve(&self, id: String, attempt: u32) -> Option<SessionReservation> {
        let (tx, rx) = mpsc::unbounded_channel();

        let previous = {
            let mut sessions = self.sessions.lock();
            if sessions
                .get(&id)
                .is_some_and(|entry| entry.attempt == attempt)
            {
                return None;
            }
            sessions.insert(id.clone(), SessionEntry { tx, attempt })
        };
        if let Some(entry) = previous {
            let _ = entry.tx.send(SessionCommand::Close);
        }
        Some(SessionReservation { id, attempt, rx })
    }

    pub fn abandon(&self, id: &str, attempt: u32) {
        let mut sessions = self.sessions.lock();
        if sessions
            .get(id)
            .is_some_and(|entry| entry.attempt == attempt)
        {
            sessions.remove(id);
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        prompts: ConnectionPrompts,
        params: ConnectParams,
        reservation: SessionReservation,
    ) {
        let id = params.session_id.clone();
        let attempt = params.attempt;
        debug_assert_eq!(reservation.id, id);
        debug_assert_eq!(reservation.attempt, attempt);

        let sessions = self.sessions.clone();
        let connections = self.connections.clone();
        tokio::spawn(async move {
            run_session(app, prompts, params, reservation.rx, connections.clone()).await;
            remove_connection(&connections, &id, attempt);
            let mut sessions = sessions.lock();
            if sessions
                .get(&id)
                .is_some_and(|entry| entry.attempt == attempt)
            {
                sessions.remove(&id);
            }
        });
    }

    pub fn send_input(&self, id: &str, attempt: u32, data: Vec<u8>) -> AppResult<()> {
        self.dispatch(id, attempt, SessionCommand::Input(data))
    }

    pub fn resize(&self, id: &str, attempt: u32, cols: u32, rows: u32) -> AppResult<()> {
        self.dispatch(id, attempt, SessionCommand::Resize(cols, rows))
    }

    pub fn close(&self, id: &str, attempt: Option<u32>) -> AppResult<()> {
        let entry = {
            let mut sessions = self.sessions.lock();
            if sessions
                .get(id)
                .is_some_and(|entry| attempt.is_none_or(|value| value == entry.attempt))
            {
                sessions.remove(id)
            } else {
                None
            }
        };
        if let Some(entry) = entry {
            let _ = entry.tx.send(SessionCommand::Close);
        }
        Ok(())
    }

    pub fn close_all(&self) {
        for (_, entry) in self.sessions.lock().drain() {
            let _ = entry.tx.send(SessionCommand::Close);
        }
    }

    fn dispatch(&self, id: &str, attempt: u32, cmd: SessionCommand) -> AppResult<()> {
        let sessions = self.sessions.lock();
        let entry = sessions
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        if entry.attempt != attempt {
            return Ok(());
        }
        entry
            .tx
            .send(cmd)
            .map_err(|_| AppError::Other("session is no longer running".into()))
    }
}

fn remove_connection(connections: &ConnectionMap, id: &str, attempt: u32) {
    let mut connections = connections.lock();
    if connections
        .get(id)
        .is_some_and(|entry| entry.attempt == attempt)
    {
        connections.remove(id);
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

    match run_session_inner(&app, &prompts, params, rx, &connections).await {
        Ok(()) => emit_status(&app, &id, attempt, "closed", None),
        Err(e) => emit_status(&app, &id, attempt, "error", Some(&e)),
    }
}

async fn run_session_inner(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    params: ConnectParams,
    mut rx: UnboundedReceiver<SessionCommand>,
    connections: &ConnectionMap,
) -> AppResult<()> {
    let ConnectParams {
        session_id: id,
        attempt,
        hops,
        cols,
        rows,
        startup_command,
    } = params;

    let conn = tokio::select! {
        result = establish(app, prompts, &id, &hops) => Arc::new(result?),
        _ = wait_close(&mut rx) => return Ok(()),
    };
    drop(hops);
    let open_channel = async {
        let channel = conn.handle.channel_open_session().await?;
        channel
            .request_pty(false, TERM, cols, rows, 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;
        Ok::<_, russh::Error>(channel)
    };
    let mut channel = tokio::select! {
        result = tokio::time::timeout(std::time::Duration::from_secs(15), open_channel) => {
            result
                .map_err(|_| AppError::Timeout("opening the SSH shell timed out".into()))??
        }
        _ = wait_close(&mut rx) => return Ok(()),
    };

    connections.lock().insert(
        id.clone(),
        ConnectionEntry {
            attempt,
            connection: conn.clone(),
        },
    );
    emit_status(app, &id, attempt, "connected", None);

    if let Some(command) = &startup_command {
        if !command.trim().is_empty() {
            let line = format!("{command}\n");
            channel.data(line.as_bytes()).await?;
        }
    }

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => emit_data(app, &id, attempt, &data),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_data(app, &id, attempt, &data),
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

    remove_connection(connections, &id, attempt);
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

#[cfg(test)]
mod tests {
    use super::{SessionCommand, SessionManager};

    #[test]
    fn newer_reservation_cancels_the_previous_attempt() {
        let manager = SessionManager::new();
        let mut first = manager.reserve("session".into(), 1).unwrap();

        let second = manager.reserve("session".into(), 2).unwrap();

        assert!(matches!(first.rx.try_recv(), Ok(SessionCommand::Close)));
        assert_eq!(second.attempt, 2);
    }

    #[test]
    fn stale_disconnect_does_not_close_the_new_attempt() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();

        manager.close("session", Some(1)).unwrap();
        assert!(current.rx.try_recv().is_err());

        manager.close("session", Some(2)).unwrap();
        assert!(matches!(current.rx.try_recv(), Ok(SessionCommand::Close)));
    }

    #[test]
    fn stale_input_is_not_dispatched_to_the_new_attempt() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();

        manager.send_input("session", 1, b"old".to_vec()).unwrap();
        assert!(current.rx.try_recv().is_err());

        manager.send_input("session", 2, b"new".to_vec()).unwrap();
        assert!(matches!(
            current.rx.try_recv(),
            Ok(SessionCommand::Input(data)) if data == b"new"
        ));
    }
}
