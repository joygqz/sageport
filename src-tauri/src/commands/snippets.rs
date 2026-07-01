use tauri::State;

use crate::domain::{Snippet, SnippetInput};
use crate::error::AppResult;
use crate::repository::snippet_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn snippets_list(state: State<'_, AppState>) -> AppResult<Vec<Snippet>> {
    snippet_repo::list(&state.db).await
}

#[tauri::command]
pub async fn snippets_create(
    state: State<'_, AppState>,
    input: SnippetInput,
) -> AppResult<Snippet> {
    snippet_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn snippets_update(
    state: State<'_, AppState>,
    id: String,
    input: SnippetInput,
) -> AppResult<Snippet> {
    snippet_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn snippets_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    snippet_repo::delete(&state.db, &id).await
}
