use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.pty.open(app, session_id, cols, rows)
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state.pty.write(&session_id, data.into_bytes())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.pty.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn pty_close(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.pty.close(&session_id)
}
