use tauri::{AppHandle, Manager, State};
use tokio::task::JoinSet;

use crate::domain::{forward_kind, PortForward, PortForwardInput};
use crate::error::{AppError, AppResult};
use crate::repository::{forward_repo, host_repo};
use crate::ssh::forward::{ForwardSpec, PendingForward, StatusEvent};
use crate::state::AppState;

fn valid_port(port: i64) -> AppResult<u16> {
    u16::try_from(port)
        .ok()
        .filter(|p| *p != 0)
        .ok_or_else(|| AppError::Invalid("port must be between 1 and 65535".into()))
}

async fn build_spec(state: &AppState, forward: &PortForward) -> AppResult<ForwardSpec> {
    let input = forward_repo::normalize(PortForwardInput {
        host_id: forward.host_id.clone(),
        label: forward.label.clone(),
        kind: forward.kind.clone(),
        bind_host: forward.bind_host.clone(),
        bind_port: forward.bind_port,
        target_host: forward.target_host.clone(),
        target_port: forward.target_port,
        auto_start: forward.auto_start != 0,
    })?;
    let host = host_repo::get(&state.db, &input.host_id).await?;
    let hops = super::ssh::build_hops(state, &host).await?;
    let (target_host, target_port) = if matches!(
        input.kind.as_str(),
        forward_kind::LOCAL | forward_kind::REMOTE
    ) {
        let target_host = input
            .target_host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .ok_or_else(|| AppError::Invalid("forward target host is required".into()))?;
        let target_port = valid_port(
            input
                .target_port
                .ok_or_else(|| AppError::Invalid("forward target port is required".into()))?,
        )?;
        (Some(target_host.to_string()), Some(target_port))
    } else {
        (None, None)
    };
    Ok(ForwardSpec {
        id: forward.id.clone(),
        kind: input.kind,
        bind_host: input.bind_host,
        bind_port: valid_port(input.bind_port)?,
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
    let lifecycle = state.forwards.lifecycle();
    let configuration = state.forwards.configuration.read().await;
    let operation = state.forwards.operation(&id).await;
    let was_active = state
        .forwards
        .active_ids()
        .iter()
        .any(|active| active == &id);
    let forward = forward_repo::update(&state.db, &id, input).await?;
    state.forwards.stop(&id).await;
    let pending = if was_active {
        match build_spec(&state, &forward).await {
            Ok(spec) => Some(
                state
                    .forwards
                    .prepare_start(
                        app.clone(),
                        state.connection_prompts.clone(),
                        spec,
                        lifecycle,
                    )
                    .await,
            ),
            Err(error) => {
                state.forwards.report_error(&app, &id, &error);
                None
            }
        }
    } else {
        state.forwards.report_stopped(&app, &id);
        None
    };
    drop(operation);
    drop(configuration);
    if let Some(pending) = pending {
        match pending {
            Ok(pending) => {
                let _ = pending.wait().await;
            }
            Err(error) => state.forwards.report_error(&app, &id, &error),
        }
    }
    Ok(forward)
}

#[tauri::command]
pub async fn forwards_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _configuration = state.forwards.configuration.read().await;
    let _operation = state.forwards.operation(&id).await;
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
    let lifecycle = state.forwards.lifecycle();
    let pending = prepare_saved_forward(&app, &state, &id, lifecycle, false).await?;
    if let Some(pending) = pending {
        pending.wait().await?;
    }
    Ok(())
}

async fn prepare_saved_forward(
    app: &AppHandle,
    state: &AppState,
    id: &str,
    lifecycle: u64,
    auto_start: bool,
) -> AppResult<Option<PendingForward>> {
    let _configuration = state.forwards.configuration.read().await;
    let _operation = state.forwards.operation(id).await;
    let forward = forward_repo::get(&state.db, id).await?;
    if auto_start && (forward.auto_start == 0 || !state.forwards.allows_auto_start(id)) {
        return Ok(None);
    }
    let spec = match build_spec(state, &forward).await {
        Ok(spec) => spec,
        Err(error) => {
            state.forwards.report_error(app, id, &error);
            return Err(error);
        }
    };
    state
        .forwards
        .prepare_start(
            app.clone(),
            state.connection_prompts.clone(),
            spec,
            lifecycle,
        )
        .await
        .map(Some)
}

#[tauri::command]
pub async fn forward_stop(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _configuration = state.forwards.configuration.read().await;
    let _operation = state.forwards.operation(&id).await;
    forward_repo::get(&state.db, &id).await?;
    state.forwards.suppress_auto_start(&id);
    if !state.forwards.stop(&id).await {
        state.forwards.report_stopped(&app, &id);
    }
    Ok(())
}

pub async fn start_auto_forwards(app: &AppHandle) {
    let state = app.state::<AppState>();
    let lifecycle = state.forwards.lifecycle();
    let Ok(forwards) = forward_repo::list_auto_start(&state.db).await else {
        return;
    };
    let mut by_host = std::collections::HashMap::<String, Vec<PortForward>>::new();
    for forward in forwards {
        by_host
            .entry(forward.host_id.clone())
            .or_default()
            .push(forward);
    }
    let mut starts = JoinSet::new();
    for forwards in by_host.into_values() {
        let task_app = app.clone();
        starts.spawn(async move {
            for forward in forwards {
                let state = task_app.state::<AppState>();
                if let Ok(Some(pending)) =
                    prepare_saved_forward(&task_app, &state, &forward.id, lifecycle, true).await
                {
                    let _ = pending.wait().await;
                }
            }
        });
    }
    while starts.join_next().await.is_some() {}
}

pub fn reconcile_running_forwards(app: &AppHandle, previous: Vec<ForwardSpec>) {
    let lifecycle = app.state::<AppState>().forwards.lifecycle();
    for old_spec in previous {
        let task_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = task_app.state::<AppState>();
            let configuration = state.forwards.configuration.read().await;
            let operation = state.forwards.operation(&old_spec.id).await;
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
            let pending = match current {
                Ok(spec) => Some(
                    state
                        .forwards
                        .prepare_start(
                            task_app.clone(),
                            state.connection_prompts.clone(),
                            spec,
                            lifecycle,
                        )
                        .await,
                ),
                Err(AppError::NotFound(_)) => None,
                Err(error) => {
                    state.forwards.report_error(&task_app, &old_spec.id, &error);
                    None
                }
            };
            drop(operation);
            drop(configuration);
            if let Some(Ok(pending)) = pending {
                let _ = pending.wait().await;
            }
        });
    }
}
