use std::collections::HashMap;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use parking_lot::Mutex;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};

use super::connect::{establish, SshConnection};
use super::{ConnectParams, ConnectionPrompts, EVENT_DATA, EVENT_STATUS, TERM};
use crate::error::{AppError, AppResult};

struct ConnectionEntry {
    attempt: u32,
    connection: Arc<SshConnection>,
}

type ConnectionMap = Arc<Mutex<HashMap<String, ConnectionEntry>>>;

const INPUT_QUEUE_CAPACITY: usize = 32;

enum SessionCommand {
    Input(Vec<u8>),
}

struct SessionEntry {
    input_tx: mpsc::Sender<SessionCommand>,
    resize_tx: watch::Sender<(u32, u32)>,
    close_tx: Option<oneshot::Sender<()>>,
    attempt: u32,
}

pub struct SessionReservation {
    id: String,
    attempt: u32,
    input_rx: mpsc::Receiver<SessionCommand>,
    resize_rx: watch::Receiver<(u32, u32)>,
    close_rx: oneshot::Receiver<()>,
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

    pub fn connection_for_attempt(&self, id: &str, attempt: u32) -> Option<Arc<SshConnection>> {
        self.connections
            .lock()
            .get(id)
            .and_then(|entry| (entry.attempt == attempt).then(|| entry.connection.clone()))
    }

    pub fn reserve(&self, id: String, attempt: u32) -> Option<SessionReservation> {
        let (input_tx, input_rx) = mpsc::channel(INPUT_QUEUE_CAPACITY);
        let (resize_tx, resize_rx) = watch::channel((0, 0));
        let (close_tx, close_rx) = oneshot::channel();

        let previous = {
            let mut sessions = self.sessions.lock();
            if sessions
                .get(&id)
                .is_some_and(|entry| entry.attempt == attempt)
            {
                return None;
            }
            sessions.insert(
                id.clone(),
                SessionEntry {
                    input_tx,
                    resize_tx,
                    close_tx: Some(close_tx),
                    attempt,
                },
            )
        };
        if let Some(mut entry) = previous {
            if let Some(close_tx) = entry.close_tx.take() {
                let _ = close_tx.send(());
            }
        }
        Some(SessionReservation {
            id,
            attempt,
            input_rx,
            resize_rx,
            close_rx,
        })
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
            run_session(app, prompts, params, reservation, connections.clone()).await;
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

    pub async fn send_input(&self, id: &str, attempt: u32, data: Vec<u8>) -> AppResult<()> {
        let tx = {
            let sessions = self.sessions.lock();
            let entry = sessions
                .get(id)
                .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
            if entry.attempt != attempt {
                return Ok(());
            }
            entry.input_tx.clone()
        };
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tx.send(SessionCommand::Input(data)),
        )
        .await
        .map_err(|_| AppError::Timeout("terminal input queue is busy".into()))?
        .map_err(|_| AppError::Other("session is no longer running".into()))
    }

    pub fn resize(&self, id: &str, attempt: u32, cols: u32, rows: u32) -> AppResult<()> {
        let sessions = self.sessions.lock();
        let entry = sessions
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))?;
        if entry.attempt != attempt {
            return Ok(());
        }
        entry
            .resize_tx
            .send((cols, rows))
            .map_err(|_| AppError::Other("session is no longer running".into()))
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
        if let Some(mut entry) = entry {
            if let Some(close_tx) = entry.close_tx.take() {
                let _ = close_tx.send(());
            }
        }
        Ok(())
    }

    pub fn close_all(&self) {
        for (_, mut entry) in self.sessions.lock().drain() {
            if let Some(close_tx) = entry.close_tx.take() {
                let _ = close_tx.send(());
            }
        }
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
    reservation: SessionReservation,
    connections: ConnectionMap,
) {
    let id = params.session_id.clone();
    let attempt = params.attempt;
    emit_status(&app, &id, attempt, "connecting", None);

    match run_session_inner(&app, &prompts, params, reservation, &connections).await {
        Ok(()) => emit_status(&app, &id, attempt, "closed", None),
        Err(e) => emit_status(&app, &id, attempt, "error", Some(&e)),
    }
}

async fn run_session_inner(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    params: ConnectParams,
    reservation: SessionReservation,
    connections: &ConnectionMap,
) -> AppResult<()> {
    let SessionReservation {
        mut input_rx,
        mut resize_rx,
        mut close_rx,
        ..
    } = reservation;
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
        _ = &mut close_rx => return Ok(()),
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
        _ = &mut close_rx => return Ok(()),
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
            biased;
            _ = &mut close_rx => break,
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => emit_data(app, &id, attempt, &data),
                    Some(ChannelMsg::ExtendedData { data, .. }) => emit_data(app, &id, attempt, &data),
                    Some(ChannelMsg::Eof) => {}
                    Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
            cmd = input_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Input(data)) => {
                        channel.data(&data[..]).await?;
                    }
                    None => break,
                }
            }
            changed = resize_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let (cols, rows) = *resize_rx.borrow_and_update();
                if cols > 0 && rows > 0 {
                    channel.window_change(cols, rows, 0, 0).await?;
                }
            }
        }
    }

    remove_connection(connections, &id, attempt);
    drop(conn);
    Ok(())
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
    use super::{SessionCommand, SessionManager, INPUT_QUEUE_CAPACITY};

    #[test]
    fn newer_reservation_cancels_the_previous_attempt() {
        let manager = SessionManager::new();
        let mut first = manager.reserve("session".into(), 1).unwrap();

        let second = manager.reserve("session".into(), 2).unwrap();

        assert!(matches!(
            first.close_rx.try_recv(),
            Ok(()) | Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
        assert_eq!(second.attempt, 2);
    }

    #[test]
    fn stale_disconnect_does_not_close_the_new_attempt() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();

        manager.close("session", Some(1)).unwrap();
        assert!(matches!(
            current.close_rx.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));

        manager.close("session", Some(2)).unwrap();
        assert!(matches!(
            current.close_rx.try_recv(),
            Ok(()) | Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
    }

    #[tokio::test]
    async fn stale_input_is_not_dispatched_to_the_new_attempt() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();

        manager
            .send_input("session", 1, b"old".to_vec())
            .await
            .unwrap();
        assert!(current.input_rx.try_recv().is_err());

        manager
            .send_input("session", 2, b"new".to_vec())
            .await
            .unwrap();
        assert!(matches!(
            current.input_rx.try_recv(),
            Ok(SessionCommand::Input(data)) if data == b"new"
        ));
    }

    #[tokio::test]
    async fn close_bypasses_a_full_input_queue() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();
        for _ in 0..INPUT_QUEUE_CAPACITY {
            manager
                .send_input("session", 2, b"x".to_vec())
                .await
                .unwrap();
        }

        manager.close("session", Some(2)).unwrap();

        assert!(matches!(
            current.close_rx.try_recv(),
            Ok(()) | Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
    }

    #[test]
    fn resize_keeps_only_the_latest_dimensions() {
        let manager = SessionManager::new();
        let mut current = manager.reserve("session".into(), 2).unwrap();

        manager.resize("session", 2, 80, 24).unwrap();
        manager.resize("session", 2, 120, 40).unwrap();

        assert!(current.resize_rx.has_changed().unwrap());
        assert_eq!(*current.resize_rx.borrow_and_update(), (120, 40));
    }
}
