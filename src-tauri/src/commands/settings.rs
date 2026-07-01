use std::collections::HashMap;

use tauri::State;

use crate::error::AppResult;
use crate::repository::settings_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    settings_repo::get(&state.db, &key).await
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    settings_repo::set(&state.db, &key, &value).await
}

#[tauri::command]
pub async fn settings_all(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    let rows = settings_repo::all(&state.db).await?;
    Ok(rows.into_iter().collect())
}
