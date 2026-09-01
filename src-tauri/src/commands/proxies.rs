use serde::Serialize;
use tauri::State;

use crate::domain::{ProxyProfileInput, ProxyProfileView};
use crate::error::{AppError, AppResult};
use crate::repository::proxy_repo;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStateView {
    profiles: Vec<ProxyProfileView>,
    active_proxy_id: Option<String>,
}

#[tauri::command]
pub async fn proxies_state(state: State<'_, AppState>) -> AppResult<ProxyStateView> {
    let profiles = proxy_repo::list(&state.db).await?;
    let active_proxy_id = proxy_repo::active_id(&state.db).await?;
    Ok(ProxyStateView {
        profiles: profiles.into_iter().map(ProxyProfileView::from).collect(),
        active_proxy_id,
    })
}

#[tauri::command]
pub async fn proxies_reveal_password(state: State<'_, AppState>, id: String) -> AppResult<String> {
    proxy_repo::get(&state.db, &id)
        .await?
        .password
        .filter(|password| !password.is_empty())
        .ok_or_else(|| AppError::NotFound(format!("password for proxy profile {id}")))
}

#[tauri::command]
pub async fn proxies_create(
    state: State<'_, AppState>,
    input: ProxyProfileInput,
) -> AppResult<ProxyProfileView> {
    Ok(proxy_repo::create(&state.db, input).await?.into())
}

#[tauri::command]
pub async fn proxies_update(
    state: State<'_, AppState>,
    id: String,
    input: ProxyProfileInput,
) -> AppResult<ProxyProfileView> {
    Ok(proxy_repo::update(&state.db, &id, input).await?.into())
}

#[tauri::command]
pub async fn proxies_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    proxy_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn proxies_set_active(state: State<'_, AppState>, id: Option<String>) -> AppResult<()> {
    proxy_repo::set_active(&state.db, id.as_deref()).await
}
