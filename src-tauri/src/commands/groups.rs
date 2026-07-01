use tauri::State;

use crate::domain::{Group, GroupInput};
use crate::error::AppResult;
use crate::repository::group_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn groups_list(state: State<'_, AppState>) -> AppResult<Vec<Group>> {
    group_repo::list(&state.db).await
}

#[tauri::command]
pub async fn groups_create(state: State<'_, AppState>, input: GroupInput) -> AppResult<Group> {
    group_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn groups_update(
    state: State<'_, AppState>,
    id: String,
    input: GroupInput,
) -> AppResult<Group> {
    group_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn groups_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    group_repo::delete(&state.db, &id).await
}
