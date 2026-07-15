use tauri::State;

use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::sanitize_appearance_value;

fn validate_key(key: &str) -> AppResult<()> {
    if matches!(
        key,
        "appearance.theme" | "appearance.locale" | "appearance.zoomLevel" | "appearance.fontFamily"
    ) {
        Ok(())
    } else {
        Err(AppError::Invalid("unknown appearance setting".into()))
    }
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    validate_key(&key)?;
    let Some(value) = settings_repo::get(&state.db, &key).await? else {
        return Ok(None);
    };
    let Some(sanitized) = sanitize_appearance_value(&key, &value) else {
        // Treat a malformed legacy/local value as absent so the UI can restore
        // its validated default instead of becoming stuck on a bad setting.
        return Ok(None);
    };
    if sanitized != value {
        settings_repo::set(&state.db, &key, &sanitized).await?;
    }
    Ok(Some(sanitized))
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    validate_key(&key)?;
    let sanitized = sanitize_appearance_value(&key, &value)
        .ok_or_else(|| AppError::Invalid("invalid appearance setting value".into()))?;
    settings_repo::set(&state.db, &key, &sanitized).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exposes_non_secret_appearance_settings() {
        assert!(validate_key("appearance.theme").is_ok());
        assert!(validate_key("appearance.fontFamily").is_ok());
        assert!(validate_key("ai.api_key").is_err());
        assert!(validate_key("sync.connection").is_err());
        assert!(validate_key("").is_err());
    }

    #[test]
    fn validates_values_at_the_ipc_boundary() {
        assert_eq!(
            sanitize_appearance_value("appearance.theme", "dark-modern").as_deref(),
            Some("midnight:dark")
        );
        assert!(sanitize_appearance_value("appearance.theme", "unknown").is_none());
        assert!(sanitize_appearance_value("appearance.locale", "fr").is_none());
        assert!(sanitize_appearance_value("appearance.zoomLevel", "1.5").is_none());
        assert!(sanitize_appearance_value("appearance.zoomLevel", "6").is_none());
        assert!(sanitize_appearance_value("appearance.fontFamily", "bad\nfont").is_none());
        assert!(sanitize_appearance_value("appearance.fontFamily", &"x".repeat(1025)).is_none());
    }
}
