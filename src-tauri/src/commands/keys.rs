use tauri::State;

use crate::domain::{SshKey, SshKeyInput};
use crate::error::AppResult;
use crate::repository::key_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn keys_list(state: State<'_, AppState>) -> AppResult<Vec<SshKey>> {
    key_repo::list(&state.db).await
}

#[tauri::command]
pub async fn keys_create(state: State<'_, AppState>, input: SshKeyInput) -> AppResult<SshKey> {
    key_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn keys_update(
    state: State<'_, AppState>,
    id: String,
    input: SshKeyInput,
) -> AppResult<SshKey> {
    key_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn keys_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    key_repo::delete(&state.db, &id).await
}
