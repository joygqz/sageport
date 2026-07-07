use tauri::{AppHandle, Manager, State};

use crate::domain::{PortForward, PortForwardInput};
use crate::error::{AppError, AppResult};
use crate::repository::{forward_repo, host_repo};
use crate::ssh::forward::ForwardSpec;
use crate::state::AppState;

fn valid_port(port: i64) -> AppResult<u16> {
    u16::try_from(port)
        .ok()
        .filter(|p| *p != 0)
        .ok_or_else(|| AppError::Invalid("port must be between 1 and 65535".into()))
}

async fn build_spec(state: &State<'_, AppState>, forward: &PortForward) -> AppResult<ForwardSpec> {
    let host = host_repo::get(&state.db, &forward.host_id).await?;
    let hops = super::ssh::build_hops(state, &host).await?;
    Ok(ForwardSpec {
        id: forward.id.clone(),
        kind: forward.kind.clone(),
        bind_host: forward.bind_host.clone(),
        bind_port: valid_port(forward.bind_port)?,
        target_host: forward.target_host.clone(),
        target_port: forward.target_port.map(|p| p as u16),
        hops,
    })
}

#[tauri::command]
pub async fn forwards_list(state: State<'_, AppState>) -> AppResult<Vec<PortForward>> {
    forward_repo::list(&state.db).await
}

#[tauri::command]
pub async fn forwards_active(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    Ok(state.forwards.active_ids().await)
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
    state.forwards.stop(&id).await;
    forward_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn forwards_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.forwards.stop(&id).await;
    forward_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn forward_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let forward = forward_repo::get(&state.db, &id).await?;
    let spec = build_spec(&state, &forward).await?;
    state
        .forwards
        .start(app, state.host_key_prompts.clone(), spec)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn forward_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.forwards.stop(&id).await;
    Ok(())
}

pub async fn start_auto_forwards(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(forwards) = forward_repo::list_auto_start(&state.db).await else {
        return;
    };
    for forward in forwards {
        if let Ok(spec) = build_spec(&state, &forward).await {
            state
                .forwards
                .start(app.clone(), state.host_key_prompts.clone(), spec)
                .await;
        }
    }
}
