use tauri::State;

use crate::ai::Protocol;
use crate::commands::ai::{self, AiConfigInput};
use crate::error::{AppError, AppResult};
use crate::repository::settings_repo;
use crate::state::AppState;
use crate::sync::sanitize_general_value;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JsonSettingsInput {
    locale: String,
    theme: String,
    font_family: String,
    zoom_level: i32,
    protocol: Protocol,
    base_url: String,
    api_key: Option<String>,
    model: String,
    auto_approve: bool,
    enabled_tools: Vec<String>,
    max_history_tokens: Option<u32>,
}

fn validate_key(key: &str) -> AppResult<()> {
    if matches!(
        key,
        "general.theme" | "general.locale" | "general.zoomLevel" | "general.fontFamily"
    ) {
        Ok(())
    } else {
        Err(AppError::Invalid("unknown general setting".into()))
    }
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    validate_key(&key)?;
    let Some(value) = settings_repo::get(&state.db, &key).await? else {
        return Ok(None);
    };
    let Some(sanitized) = sanitize_general_value(&key, &value) else {
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
    let sanitized = sanitize_general_value(&key, &value)
        .ok_or_else(|| AppError::Invalid("invalid general setting value".into()))?;
    settings_repo::set(&state.db, &key, &sanitized).await
}

#[tauri::command]
pub async fn settings_apply_json(
    state: State<'_, AppState>,
    input: JsonSettingsInput,
) -> AppResult<()> {
    let entries = validate_json_settings(input)?;
    settings_repo::set_many(&state.db, &entries).await
}

fn validate_json_settings(input: JsonSettingsInput) -> AppResult<Vec<(String, String)>> {
    let general = [
        ("general.locale", input.locale),
        ("general.theme", input.theme),
        ("general.fontFamily", input.font_family),
        ("general.zoomLevel", input.zoom_level.to_string()),
    ];
    let mut entries = general
        .into_iter()
        .map(|(key, value)| {
            sanitize_general_value(key, &value)
                .map(|sanitized| (key.to_string(), sanitized))
                .ok_or_else(|| AppError::Invalid(format!("invalid value for {key}")))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let validated_ai = ai::validate_ai_config(AiConfigInput {
        base_url: input.base_url,
        protocol: input.protocol,
        api_key: input.api_key,
        auto_approve: input.auto_approve,
        enabled_tools: Some(input.enabled_tools),
        max_history_tokens: input.max_history_tokens,
    })?;
    entries.extend(validated_ai.entries);
    entries.push(("ai.model".into(), ai::validate_ai_model(&input.model)?));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exposes_non_secret_general_settings() {
        assert!(validate_key("general.theme").is_ok());
        assert!(validate_key("general.fontFamily").is_ok());
        assert!(validate_key("appearance.theme").is_err());
        assert!(validate_key("ai.api_key").is_err());
        assert!(validate_key("sync.connection").is_err());
        assert!(validate_key("").is_err());
    }

    #[test]
    fn validates_values_at_the_ipc_boundary() {
        assert_eq!(
            sanitize_general_value("general.theme", "dark-modern").as_deref(),
            Some("midnight:dark")
        );
        assert!(sanitize_general_value("general.theme", "unknown").is_none());
        assert!(sanitize_general_value("general.locale", "fr").is_none());
        assert!(sanitize_general_value("general.zoomLevel", "1.5").is_none());
        assert!(sanitize_general_value("general.zoomLevel", "6").is_none());
        assert!(sanitize_general_value("general.fontFamily", "bad\nfont").is_none());
        assert!(sanitize_general_value("general.fontFamily", &"x".repeat(1025)).is_none());
    }

    #[test]
    fn json_settings_preserve_or_replace_api_keys_explicitly() {
        let input = |api_key| JsonSettingsInput {
            locale: "en".into(),
            theme: "midnight:dark".into(),
            font_family: String::new(),
            zoom_level: 0,
            protocol: Protocol::Openai,
            base_url: "https://example.com/v1".into(),
            api_key,
            model: "model".into(),
            auto_approve: false,
            enabled_tools: Vec::new(),
            max_history_tokens: None,
        };

        let preserved = validate_json_settings(input(None)).unwrap();
        assert!(!preserved.iter().any(|(key, _)| key == "ai.api_key"));

        let replaced = validate_json_settings(input(Some(" secret ".into()))).unwrap();
        assert!(replaced
            .iter()
            .any(|(key, value)| key == "ai.api_key" && value == "secret"));
    }
}
