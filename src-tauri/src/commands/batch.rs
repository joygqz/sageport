use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::error::{AppError, AppResult};
use crate::repository::{history_repo, host_repo};
use crate::ssh::exec::exec_capture_limited;
use crate::ssh::{establish, Hop};
use crate::state::{AppState, CancelEntry};

const BATCH_CONCURRENCY: usize = 4;
const MAX_BATCH_HOSTS: usize = 100;
const MAX_ID_BYTES: usize = 128;
const MAX_COMMAND_CHARS: usize = 32 * 1024;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecEvent {
    host_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[tauri::command]
pub async fn hosts_run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    host_ids: Vec<String>,
    command: String,
    request_id: String,
    on_event: Channel<BatchExecEvent>,
) -> AppResult<()> {
    let (host_ids, command) = validate_input(host_ids, command, &request_id)?;
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
    let generation = state.next_request_generation();
    {
        let mut cancels = state.batch_cancels.lock();
        if cancels.contains_key(&request_id) {
            return Err(AppError::Invalid("batch request is already running".into()));
        }
        cancels.insert(
            request_id.clone(),
            CancelEntry {
                generation,
                sender: Some(cancel_tx),
            },
        );
    }

    let mut targets: Vec<(String, AppResult<Vec<Hop>>)> = Vec::new();
    for host_id in host_ids {
        if cancellation_requested(&mut cancel_rx) {
            remove_cancel_if_current(&state, &request_id, generation);
            return Err(AppError::Cancelled);
        }
        let prepared = match host_repo::get(&state.db, &host_id).await {
            Ok(host) => super::ssh::build_hops(&state, &host).await,
            Err(error) => Err(error),
        };
        targets.push((host_id, prepared));
    }
    if cancellation_requested(&mut cancel_rx) {
        remove_cancel_if_current(&state, &request_id, generation);
        return Err(AppError::Cancelled);
    }

    let prompts = state.connection_prompts.clone();
    let db = state.db.clone();
    let limit = Arc::new(Semaphore::new(BATCH_CONCURRENCY));
    let mut tasks = JoinSet::new();

    for (host_id, prepared) in targets {
        let app = app.clone();
        let prompts = prompts.clone();
        let db = db.clone();
        let command = command.clone();
        let limit = limit.clone();
        let on_event = on_event.clone();
        let request_id = request_id.clone();
        tasks.spawn(async move {
            let Ok(_permit) = limit.acquire_owned().await else {
                return;
            };
            let _ = on_event.send(BatchExecEvent {
                host_id: host_id.clone(),
                status: "running".into(),
                output: None,
                exit_code: None,
                message: None,
            });

            let session_id = format!("batch:{request_id}:{host_id}");
            let result = async {
                let hops = prepared?;
                let conn = establish(&app, &prompts, &session_id, &hops).await?;
                let out = tokio::time::timeout(
                    COMMAND_TIMEOUT,
                    exec_capture_limited(&conn.handle, &command, MAX_OUTPUT_BYTES),
                )
                .await
                .map_err(|_| AppError::Timeout("batch command timed out".into()))??;
                let _ = history_repo::add(&db, &host_id, &command).await;
                Ok::<_, AppError>(out)
            }
            .await;

            let event = match result {
                Ok(out) => {
                    let combined = combine_output(out.stdout, out.stderr);
                    BatchExecEvent {
                        host_id,
                        status: "done".into(),
                        output: Some(combined),
                        exit_code: Some(out.code),
                        message: None,
                    }
                }
                Err(e) => BatchExecEvent {
                    host_id,
                    status: "error".into(),
                    output: None,
                    exit_code: None,
                    message: Some(e.to_string()),
                },
            };
            let _ = on_event.send(event);
        });
    }

    let result = loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                tasks.abort_all();
                while tasks.join_next().await.is_some() {}
                break Err(AppError::Cancelled);
            }
            joined = tasks.join_next() => {
                if joined.is_none() {
                    break Ok(());
                }
            }
        }
    };
    remove_cancel_if_current(&state, &request_id, generation);
    result
}

fn cancellation_requested(cancel: &mut tokio::sync::oneshot::Receiver<()>) -> bool {
    !matches!(
        cancel.try_recv(),
        Err(tokio::sync::oneshot::error::TryRecvError::Empty)
    )
}

#[tauri::command]
pub async fn hosts_cancel_run(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    validate_id(&request_id, "batch request")?;
    if let Some(cancel) = state
        .batch_cancels
        .lock()
        .get_mut(&request_id)
        .and_then(|entry| entry.sender.take())
    {
        let _ = cancel.send(());
    }
    Ok(())
}

fn remove_cancel_if_current(state: &AppState, request_id: &str, generation: u64) {
    let mut cancels = state.batch_cancels.lock();
    if cancels
        .get(request_id)
        .is_some_and(|entry| entry.generation == generation)
    {
        cancels.remove(request_id);
    }
}

fn validate_id(id: &str, label: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES || id.contains('\0') {
        return Err(AppError::Invalid(format!("invalid {label} id")));
    }
    Ok(())
}

fn validate_input(
    host_ids: Vec<String>,
    command: String,
    request_id: &str,
) -> AppResult<(Vec<String>, String)> {
    validate_id(request_id, "batch request")?;
    if host_ids.is_empty() || host_ids.len() > MAX_BATCH_HOSTS {
        return Err(AppError::Invalid(format!(
            "batch runs need between 1 and {MAX_BATCH_HOSTS} hosts"
        )));
    }
    let mut unique = std::collections::HashSet::new();
    let mut normalized = Vec::with_capacity(host_ids.len());
    for host_id in host_ids {
        let host_id = host_id.trim().to_string();
        validate_id(&host_id, "host")?;
        if unique.insert(host_id.clone()) {
            normalized.push(host_id);
        }
    }
    let command = command.trim().to_string();
    if command.is_empty() || command.chars().count() > MAX_COMMAND_CHARS || command.contains('\0') {
        return Err(AppError::Invalid("invalid batch command".into()));
    }
    Ok((normalized, command))
}

fn combine_output(stdout: String, stderr: String) -> String {
    if stderr.trim().is_empty() {
        return stdout;
    }
    if stdout.trim().is_empty() {
        return stderr;
    }
    let separator = if stdout.ends_with('\n') || stderr.starts_with('\n') {
        ""
    } else {
        "\n"
    };
    format!("{stdout}{separator}{stderr}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_deduplicates_batch_input() {
        let (hosts, command) = validate_input(
            vec![" host-1 ".into(), "host-1".into(), "host-2".into()],
            "  uptime  ".into(),
            "request-1",
        )
        .unwrap();
        assert_eq!(hosts, ["host-1", "host-2"]);
        assert_eq!(command, "uptime");

        assert!(validate_input(Vec::new(), "uptime".into(), "request-1").is_err());
        assert!(validate_input(vec!["host".into()], "  ".into(), "request-1").is_err());
        assert!(validate_input(
            vec!["host".into()],
            "x".repeat(MAX_COMMAND_CHARS + 1),
            "request-1"
        )
        .is_err());
        assert!(validate_input(
            vec!["host".into()],
            "命".repeat(MAX_COMMAND_CHARS),
            "request-1"
        )
        .is_ok());
    }

    #[test]
    fn separates_stdout_and_stderr() {
        assert_eq!(combine_output("out".into(), "err".into()), "out\nerr");
        assert_eq!(combine_output("out\n".into(), "err".into()), "out\nerr");
        assert_eq!(combine_output("".into(), "err".into()), "err");
    }

    #[test]
    fn dropped_cleanup_sender_is_treated_as_cancellation() {
        let (sender, mut receiver) = tokio::sync::oneshot::channel();
        assert!(!cancellation_requested(&mut receiver));
        drop(sender);
        assert!(cancellation_requested(&mut receiver));
    }
}
