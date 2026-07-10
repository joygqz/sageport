use tauri::State;

use crate::ai::{self, Endpoint, Protocol};
use crate::error::{AppError, AppResult};
use crate::repository::ai_session_repo::{self, AiSessionRow};
use crate::repository::settings_repo;
use crate::state::AppState;

const BASE_URL_SETTING: &str = "ai.base_url";
const API_KEY_SETTING: &str = "ai.api_key";
const PROTOCOL_SETTING: &str = "ai.protocol";
const MODEL_SETTING: &str = "ai.model";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub api_key: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub model: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigInput {
    pub base_url: String,
    pub protocol: Protocol,
    pub api_key: Option<String>,
}

async fn stored_protocol(state: &AppState) -> AppResult<Protocol> {
    Ok(Protocol::from_str(
        &settings_repo::get(&state.db, PROTOCOL_SETTING)
            .await?
            .unwrap_or_default(),
    ))
}

async fn stored_base_url(state: &AppState, protocol: Protocol) -> AppResult<String> {
    Ok(settings_repo::get(&state.db, BASE_URL_SETTING)
        .await?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| protocol.default_base_url().to_string()))
}

fn effective_base_url(raw: &str, protocol: Protocol) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        protocol.default_base_url().to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub async fn ai_get_config(state: State<'_, AppState>) -> AppResult<AiConfig> {
    let api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .unwrap_or_default();
    let protocol = stored_protocol(&state).await?;
    let base_url = stored_base_url(&state, protocol).await?;
    let model = settings_repo::get(&state.db, MODEL_SETTING)
        .await?
        .unwrap_or_default();
    Ok(AiConfig {
        api_key,
        base_url,
        protocol,
        model,
    })
}

#[tauri::command]
pub async fn ai_set_config(state: State<'_, AppState>, input: AiConfigInput) -> AppResult<()> {
    let previous_protocol = stored_protocol(&state).await?;
    let previous_base_url = stored_base_url(&state, previous_protocol).await?;
    if previous_protocol != input.protocol
        || effective_base_url(&previous_base_url, previous_protocol)
            != effective_base_url(&input.base_url, input.protocol)
    {
        settings_repo::set(&state.db, MODEL_SETTING, "").await?;
    }
    settings_repo::set(&state.db, BASE_URL_SETTING, input.base_url.trim()).await?;
    settings_repo::set(&state.db, PROTOCOL_SETTING, input.protocol.as_str()).await?;
    settings_repo::set(
        &state.db,
        API_KEY_SETTING,
        input.api_key.as_deref().unwrap_or_default().trim(),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_set_model(state: State<'_, AppState>, model: String) -> AppResult<()> {
    settings_repo::set(&state.db, MODEL_SETTING, model.trim()).await
}

async fn endpoint(state: &AppState) -> AppResult<(String, String, Protocol)> {
    let api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| AppError::Invalid("no API key configured".into()))?;
    let protocol = stored_protocol(state).await?;
    let base_url = stored_base_url(state, protocol).await?;
    Ok((base_url, api_key, protocol))
}

#[tauri::command]
pub async fn ai_list_models(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let (base_url, api_key, protocol) = endpoint(&state).await?;
    ai::list_models(&Endpoint {
        base_url: &base_url,
        api_key: &api_key,
        protocol,
    })
    .await
}

#[tauri::command]
pub async fn ai_model_limits(
    state: State<'_, AppState>,
    model: String,
) -> AppResult<ai::ModelLimits> {
    let model = model.trim();
    if model.is_empty() {
        return Ok(ai::ModelLimits::default());
    }
    let (base_url, api_key, protocol) = endpoint(&state).await?;
    Ok(ai::model_limits(
        &Endpoint {
            base_url: &base_url,
            api_key: &api_key,
            protocol,
        },
        model,
    )
    .await)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatInput {
    model: String,
    messages: Vec<ai::ChatMessage>,
    tools: Vec<ai::ToolSpec>,
    context: Option<String>,
    max_tokens: Option<u32>,
    request_id: Option<String>,
}

#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    input: AiChatInput,
    on_delta: tauri::ipc::Channel<ai::StreamEvent>,
) -> AppResult<ai::ChatResult> {
    let AiChatInput {
        model,
        messages,
        tools,
        context,
        max_tokens,
        request_id,
    } = input;
    let model = model.trim();
    if model.is_empty() {
        return Err(AppError::Invalid("no model selected".into()));
    }
    let (base_url, api_key, protocol) = endpoint(&state).await?;
    let ep = Endpoint {
        base_url: &base_url,
        api_key: &api_key,
        protocol,
    };
    let chat = ai::chat(
        &ep,
        model,
        &messages,
        &tools,
        context.as_deref(),
        max_tokens
            .unwrap_or(ai::DEFAULT_MAX_OUTPUT_TOKENS)
            .clamp(1, ai::MAX_OUTPUT_TOKENS),
        |text| {
            let _ = on_delta.send(ai::StreamEvent::Text {
                text: text.to_string(),
            });
        },
    );

    let Some(request_id) = request_id else {
        return chat.await;
    };

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state
        .ai_cancels
        .lock()
        .insert(request_id.clone(), cancel_tx);
    let result = tokio::select! {
        r = chat => r,
        _ = cancel_rx => Err(AppError::Cancelled),
    };
    state.ai_cancels.lock().remove(&request_id);
    result
}

#[tauri::command]
pub async fn ai_chat_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    if let Some(tx) = state.ai_cancels.lock().remove(&request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    pub id: String,
    pub title: String,
    pub messages: Vec<ai::ChatMessage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

impl AiSession {
    fn from_row(row: AiSessionRow) -> AppResult<Self> {
        Ok(Self {
            id: row.id,
            title: row.title,
            messages: serde_json::from_str(&row.messages)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl From<AiSessionRow> for AiSessionSummary {
    fn from(row: AiSessionRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[tauri::command]
pub async fn ai_session_list(state: State<'_, AppState>) -> AppResult<Vec<AiSessionSummary>> {
    let rows = ai_session_repo::list(&state.db).await?;
    Ok(rows.into_iter().map(AiSessionSummary::from).collect())
}

#[tauri::command]
pub async fn ai_session_create(state: State<'_, AppState>) -> AppResult<AiSession> {
    let row = ai_session_repo::create(&state.db).await?;
    AiSession::from_row(row)
}

#[tauri::command]
pub async fn ai_session_get(state: State<'_, AppState>, id: String) -> AppResult<AiSession> {
    let row = ai_session_repo::get(&state.db, &id).await?;
    AiSession::from_row(row)
}

#[tauri::command]
pub async fn ai_session_save(
    state: State<'_, AppState>,
    id: String,
    messages: Vec<ai::ChatMessage>,
    title: Option<String>,
) -> AppResult<AiSessionSummary> {
    let messages_json = serde_json::to_string(&messages)?;
    let row = ai_session_repo::save(&state.db, &id, &messages_json, title.as_deref()).await?;
    Ok(AiSessionSummary::from(row))
}

#[tauri::command]
pub async fn ai_session_rename(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<AiSessionSummary> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("title must not be empty".into()));
    }
    let row = ai_session_repo::rename(&state.db, &id, title).await?;
    Ok(AiSessionSummary::from(row))
}

#[tauri::command]
pub async fn ai_session_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    ai_session_repo::delete(&state.db, &id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_url_normalizes_defaults_and_trailing_slashes() {
        assert_eq!(
            effective_base_url("", Protocol::Openai),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            effective_base_url(" https://example.com/v1/// ", Protocol::Openai),
            "https://example.com/v1"
        );
    }
}
