use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

const MAX_INPUT_BYTES: usize = 1024 * 1024;

async fn run_blocking(operation: impl FnOnce() -> AppResult<()> + Send + 'static) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| AppError::Other(format!("terminal worker failed: {error}")))?
}

fn validate_session_id(session_id: &str) -> AppResult<()> {
    if session_id.trim().is_empty() || session_id.len() > 128 {
        return Err(AppError::Invalid("invalid terminal session id".into()));
    }
    Ok(())
}

fn validate_dimensions(cols: u32, rows: u32) -> AppResult<()> {
    if !(1..=10_000).contains(&cols) || !(1..=10_000).contains(&rows) {
        return Err(AppError::Invalid(
            "terminal dimensions must be between 1 and 10000".into(),
        ));
    }
    Ok(())
}

fn validate_input(data: &str) -> AppResult<()> {
    if data.len() > MAX_INPUT_BYTES {
        return Err(AppError::Invalid("terminal input is too large".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    validate_dimensions(cols, rows)?;
    let pty = state.pty.clone();
    run_blocking(move || pty.open(app, session_id, attempt, cols, rows)).await
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    data: String,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    validate_input(&data)?;
    let pty = state.pty.clone();
    run_blocking(move || pty.write(&session_id, attempt, data.into_bytes())).await
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    validate_dimensions(cols, rows)?;
    let pty = state.pty.clone();
    run_blocking(move || pty.resize(&session_id, attempt, cols, rows)).await
}

#[tauri::command]
pub async fn pty_close(
    state: State<'_, AppState>,
    session_id: String,
    attempt: Option<u32>,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    let pty = state.pty.clone();
    run_blocking(move || pty.close(&session_id, attempt)).await
}

#[cfg(test)]
mod tests {
    use super::{validate_dimensions, validate_input, validate_session_id, MAX_INPUT_BYTES};

    #[test]
    fn rejects_invalid_session_ids() {
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("   ").is_err());
        assert!(validate_session_id(&"x".repeat(129)).is_err());
        assert!(validate_session_id("terminal-1").is_ok());
    }

    #[test]
    fn rejects_invalid_terminal_dimensions() {
        assert!(validate_dimensions(0, 24).is_err());
        assert!(validate_dimensions(80, 0).is_err());
        assert!(validate_dimensions(10_001, 24).is_err());
        assert!(validate_dimensions(80, 10_001).is_err());
        assert!(validate_dimensions(80, 24).is_ok());
    }

    #[test]
    fn rejects_oversized_terminal_input() {
        assert!(validate_input(&"x".repeat(MAX_INPUT_BYTES)).is_ok());
        assert!(validate_input(&"x".repeat(MAX_INPUT_BYTES + 1)).is_err());
    }
}
