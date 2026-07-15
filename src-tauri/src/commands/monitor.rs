use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::state::AppState;

fn validate_session_id(session_id: &str) -> AppResult<()> {
    if session_id.trim().is_empty() || session_id.len() > 128 {
        return Err(crate::error::AppError::Invalid(
            "invalid monitor session id".into(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn monitor_start(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    state
        .monitor
        .start(app, state.ssh.clone(), session_id, attempt)
}

#[tauri::command]
pub async fn monitor_stop(
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
) -> AppResult<()> {
    validate_session_id(&session_id)?;
    state.monitor.stop(&session_id, attempt);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_session_id;

    #[test]
    fn rejects_invalid_session_ids() {
        assert!(validate_session_id("").is_err());
        assert!(validate_session_id("   ").is_err());
        assert!(validate_session_id(&"x".repeat(129)).is_err());
        assert!(validate_session_id("terminal-1").is_ok());
    }
}
