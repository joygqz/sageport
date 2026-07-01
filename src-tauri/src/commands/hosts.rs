use tauri::State;

use crate::domain::{Host, HostInput};
use crate::error::AppResult;
use crate::repository::host_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn hosts_list(state: State<'_, AppState>) -> AppResult<Vec<Host>> {
    host_repo::list(&state.db).await
}

#[tauri::command]
pub async fn hosts_get(state: State<'_, AppState>, id: String) -> AppResult<Host> {
    host_repo::get(&state.db, &id).await
}

#[tauri::command]
pub async fn hosts_create(state: State<'_, AppState>, input: HostInput) -> AppResult<Host> {
    host_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn hosts_update(
    state: State<'_, AppState>,
    id: String,
    input: HostInput,
) -> AppResult<Host> {
    host_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn hosts_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    host_repo::delete(&state.db, &id).await
}
