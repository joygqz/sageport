use tauri::State;

use crate::domain::{SftpBookmark, SftpBookmarkInput};
use crate::error::AppResult;
use crate::repository::bookmark_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn bookmarks_list(state: State<'_, AppState>) -> AppResult<Vec<SftpBookmark>> {
    bookmark_repo::list(&state.db).await
}

#[tauri::command]
pub async fn bookmarks_create(
    state: State<'_, AppState>,
    input: SftpBookmarkInput,
) -> AppResult<SftpBookmark> {
    bookmark_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn bookmarks_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    bookmark_repo::delete(&state.db, &id).await
}
