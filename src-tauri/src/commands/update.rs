use tauri::{AppHandle, State};

use crate::state::AppState;
use crate::update::{self, UpdateStatus};

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
