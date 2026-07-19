use tauri::{AppHandle, Manager, State};
use tokio::task::JoinSet;

use crate::domain::{forward_kind, PortForward, PortForwardInput};
use crate::error::{AppError, AppResult};
use crate::repository::{forward_repo, host_repo};
use crate::ssh::forward::{ForwardSpec, StatusEvent};
use crate::state::AppState;

fn valid_port(port: i64) -> AppResult<u16> {
    u16::try_from(port)
        .ok()
        .filter(|p| *p != 0)
        .ok_or_else(|| AppError::Invalid("port must be between 1 and 65535".into()))
}

async fn build_spec(state: &AppState, forward: &PortForward) -> AppResult<ForwardSpec> {
    if !matches!(
        forward.kind.as_str(),
        forward_kind::LOCAL | forward_kind::REMOTE | forward_kind::DYNAMIC
    ) {
        return Err(AppError::Invalid(format!(
            "unknown forward kind: {}",
            forward.kind
        )));
    }
    let host = host_repo::get(&state.db, &forward.host_id).await?;
    let hops = super::ssh::build_hops(state, &host).await?;
    let (target_host, target_port) = if matches!(
        forward.kind.as_str(),
        forward_kind::LOCAL | forward_kind::REMOTE
    ) {
        let target_host = forward
            .target_host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .ok_or_else(|| AppError::Invalid("forward target host is required".into()))?;
        let target_port = valid_port(
            forward
                .target_port
                .ok_or_else(|| AppError::Invalid("forward target port is required".into()))?,
        )?;
        (Some(target_host.to_string()), Some(target_port))
    } else {
        (None, None)
    };
    Ok(ForwardSpec {
        id: forward.id.clone(),
        kind: forward.kind.clone(),
        bind_host: forward.bind_host.clone(),
        bind_port: valid_port(forward.bind_port)?,
        target_host,
        target_port,
        hops,
    })
}

#[tauri::command]
pub async fn forwards_list(state: State<'_, AppState>) -> AppResult<Vec<PortForward>> {
    forward_repo::list(&state.db).await
}

#[tauri::command]
pub async fn forwards_active(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.forwards.active_ids())
}

#[tauri::command]
pub async fn forwards_runtime(state: State<'_, AppState>) -> AppResult<Vec<StatusEvent>> {
    let valid_ids = forward_repo::list(&state.db)
        .await?
        .into_iter()
        .map(|forward| forward.id)
        .collect::<std::collections::HashSet<_>>();
    Ok(state
        .forwards
        .runtime()
        .into_iter()
        .filter(|event| valid_ids.contains(&event.forward_id))
        .collect())
}

#[tauri::command]
pub async fn forwards_create(
    state: State<'_, AppState>,
    input: PortForwardInput,
) -> AppResult<PortForward> {
    forward_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn forwards_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    input: PortForwardInput,
) -> AppResult<PortForward> {
    let was_active = state
        .forwards
        .active_ids()
        .iter()
        .any(|active| active == &id);
    let forward = forward_repo::update(&state.db, &id, input).await?;
    state.forwards.stop(&id).await;
    state.forwards.forget(&id);
    if was_active {
        match build_spec(&state, &forward).await {
            Ok(spec) => {
                let _ = state
                    .forwards
                    .start(app, state.connection_prompts.clone(), spec)
                    .await;
            }
            Err(error) => state.forwards.report_error(&app, &id, &error),
        }
    }
    Ok(forward)
}

#[tauri::command]
pub async fn forwards_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    forward_repo::delete(&state.db, &id).await?;
    state.forwards.stop(&id).await;
    state.forwards.forget(&id);
    Ok(())
}

#[tauri::command]
pub async fn forward_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let forward = forward_repo::get(&state.db, &id).await?;
    let spec = match build_spec(&state, &forward).await {
        Ok(spec) => spec,
        Err(error) => {
            state.forwards.report_error(&app, &id, &error);
            return Err(error);
        }
    };
    state
        .forwards
        .start(app, state.connection_prompts.clone(), spec)
        .await
}

#[tauri::command]
pub async fn forward_stop(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    forward_repo::get(&state.db, &id).await?;
    state.forwards.stop(&id).await;
    state.forwards.report_stopped(&app, &id);
    Ok(())
}

pub async fn start_auto_forwards(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(forwards) = forward_repo::list_auto_start(&state.db).await else {
        return;
    };
    let mut starts = JoinSet::new();
    for forward in forwards {
        let task_app = app.clone();
        starts.spawn(async move {
            let state = task_app.state::<AppState>();
            match build_spec(&state, &forward).await {
                Ok(spec) => {
                    let _ = state
                        .forwards
                        .start(task_app.clone(), state.connection_prompts.clone(), spec)
                        .await;
                }
                Err(error) => state.forwards.report_error(&task_app, &forward.id, &error),
            }
        });
    }
    while starts.join_next().await.is_some() {}
}

pub fn reconcile_running_forwards(app: &AppHandle, previous: Vec<ForwardSpec>) {
    for old_spec in previous {
        let task_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = task_app.state::<AppState>();
            let current = match forward_repo::get(&state.db, &old_spec.id).await {
                Ok(forward) => build_spec(&state, &forward).await,
                Err(error) => Err(error),
            };
            if current.as_ref().is_ok_and(|spec| spec == &old_spec) {
                return;
            }
            if !state.forwards.stop_if_spec(&old_spec).await {
                return;
            }
            state.forwards.forget(&old_spec.id);
            match current {
                Ok(spec) => {
                    let _ = state
                        .forwards
                        .start(task_app.clone(), state.connection_prompts.clone(), spec)
                        .await;
                }
                Err(AppError::NotFound(_)) => {}
                Err(error) => state.forwards.report_error(&task_app, &old_spec.id, &error),
            }
        });
    }
}
