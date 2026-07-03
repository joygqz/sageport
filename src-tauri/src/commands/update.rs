use tauri::{AppHandle, State};

use crate::state::AppState;
use crate::update::{self, UpdateStatus};

/// Current status, for a window to sync to on mount (e.g. Settings reopening
/// after a download finished elsewhere).
#[tauri::command]
pub fn update_status(state: State<'_, AppState>) -> UpdateStatus {
    state.update.snapshot()
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateStatus {
    update::check(&app).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> UpdateStatus {
    update::install(&app).await
}
