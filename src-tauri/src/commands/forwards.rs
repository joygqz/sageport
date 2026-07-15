use tauri::{AppHandle, Manager, State};

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

async fn build_spec(state: &State<'_, AppState>, forward: &PortForward) -> AppResult<ForwardSpec> {
    if !matches!(
        forward.kind.as_str(),
        forward_kind::LOCAL | forward_kind::DYNAMIC
    ) {
        return Err(AppError::Invalid(format!(
            "unknown forward kind: {}",
            forward.kind
        )));
    }
    let host = host_repo::get(&state.db, &forward.host_id).await?;
    let hops = super::ssh::build_hops(state, &host).await?;
    let (target_host, target_port) = if forward.kind == forward_kind::LOCAL {
        let target_host = forward
            .target_host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .ok_or_else(|| AppError::Invalid("local forward target host is required".into()))?;
        let target_port =
            valid_port(forward.target_port.ok_or_else(|| {
                AppError::Invalid("local forward target port is required".into())
            })?)?;
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
    state: State<'_, AppState>,
    id: String,
    input: PortForwardInput,
) -> AppResult<PortForward> {
    let forward = forward_repo::update(&state.db, &id, input).await?;
    state.forwards.stop(&id).await;
    state.forwards.forget(&id);
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
    for forward in forwards {
        match build_spec(&state, &forward).await {
            Ok(spec) => {
                let _ = state
                    .forwards
                    .start(app.clone(), state.connection_prompts.clone(), spec)
                    .await;
            }
            Err(error) => state.forwards.report_error(app, &forward.id, &error),
        }
    }
}
