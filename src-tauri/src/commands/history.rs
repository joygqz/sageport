use tauri::State;

use crate::domain::CommandHistoryEntry;
use crate::error::AppResult;
use crate::repository::history_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn history_add(
    state: State<'_, AppState>,
    host_id: Option<String>,
    command: String,
) -> AppResult<()> {
    history_repo::add(&state.db, host_id.as_deref().unwrap_or(""), &command).await
}

#[tauri::command]
pub async fn history_search(
    state: State<'_, AppState>,
    host_id: Option<String>,
    prefix: String,
    limit: Option<i64>,
) -> AppResult<Vec<String>> {
    if prefix.trim().is_empty() {
        return Ok(Vec::new());
    }
    history_repo::search(
        &state.db,
        host_id.as_deref().unwrap_or(""),
        &prefix,
        limit.unwrap_or(5),
    )
    .await
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    host_id: Option<String>,
    query: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<CommandHistoryEntry>> {
    history_repo::list(
        &state.db,
        host_id.as_deref(),
        query.as_deref(),
        limit.unwrap_or(200),
    )
    .await
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    history_repo::clear(&state.db).await
}
