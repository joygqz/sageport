use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn monitor_start(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> AppResult<()> {
    state.monitor.start(app, state.ssh.clone(), session_id);
    Ok(())
}

#[tauri::command]
pub async fn monitor_stop(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.monitor.stop(&session_id);
    Ok(())
}
