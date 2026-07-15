use tauri::State;

use crate::domain::{SftpBookmark, SftpBookmarkInput};
use crate::error::{AppError, AppResult};
use crate::repository::{bookmark_repo, host_repo};
use crate::state::AppState;

#[tauri::command]
pub async fn bookmarks_list(state: State<'_, AppState>) -> AppResult<Vec<SftpBookmark>> {
    bookmark_repo::list(&state.db).await
}

#[tauri::command]
pub async fn bookmarks_create(
    state: State<'_, AppState>,
    mut input: SftpBookmarkInput,
) -> AppResult<SftpBookmark> {
    input.host_id = input
        .host_id
        .map(|host_id| host_id.trim().to_string())
        .filter(|host_id| !host_id.is_empty());
    if let Some(host_id) = input.host_id.as_deref() {
        if host_id.len() > 128 || host_id.contains('\0') {
            return Err(AppError::Invalid("invalid bookmark host id".into()));
        }
        host_repo::get(&state.db, host_id).await?;
    }
    bookmark_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn bookmarks_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > 128 {
        return Err(AppError::Invalid("invalid bookmark id".into()));
    }
    bookmark_repo::delete(&state.db, &id).await
}
