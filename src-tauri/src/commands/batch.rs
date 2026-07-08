use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::error::{AppError, AppResult};
use crate::repository::host_repo;
use crate::ssh::{establish, exec_capture, Hop};
use crate::state::AppState;

const BATCH_CONCURRENCY: usize = 4;

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
    on_event: Channel<BatchExecEvent>,
) -> AppResult<()> {
    let mut targets: Vec<(String, Vec<Hop>)> = Vec::new();
    for host_id in &host_ids {
        let host = host_repo::get(&state.db, host_id).await?;
        let hops = super::ssh::build_hops(&state, &host).await?;
        targets.push((host_id.clone(), hops));
    }

    let prompts = state.host_key_prompts.clone();
    let limit = Arc::new(Semaphore::new(BATCH_CONCURRENCY));
    let mut tasks = JoinSet::new();

    for (host_id, hops) in targets {
        let app = app.clone();
        let prompts = prompts.clone();
        let command = command.clone();
        let limit = limit.clone();
        let on_event = on_event.clone();
        tasks.spawn(async move {
            let _permit = limit.acquire_owned().await;
            let _ = on_event.send(BatchExecEvent {
                host_id: host_id.clone(),
                status: "running".into(),
                output: None,
                exit_code: None,
                message: None,
            });

            let session_id = format!("batch:{host_id}");
            let result = async {
                let conn = establish(&app, &prompts, &session_id, &hops).await?;
                let out = exec_capture(&conn.handle, &command).await?;
                Ok::<_, AppError>(out)
            }
            .await;

            let event = match result {
                Ok(out) => {
                    let combined = if out.stderr.trim().is_empty() {
                        out.stdout
                    } else if out.stdout.trim().is_empty() {
                        out.stderr
                    } else {
                        format!("{}{}", out.stdout, out.stderr)
                    };
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

    while tasks.join_next().await.is_some() {}
    Ok(())
}
