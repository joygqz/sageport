//! AI assistant configuration. Credentials and preferences live in the settings
//! table alongside the rest of the app's data — no OS keychain dependency.
//!
//! The assistant is vendor-neutral: the user supplies a base URL, an API key,
//! and a protocol (OpenAI- or Anthropic-compatible). Models are fetched live
//! from the provider rather than hard-coded.

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

/// Non-secret view of the AI configuration exposed to the UI.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub has_api_key: bool,
    pub base_url: String,
    pub protocol: Protocol,
    pub model: String,
}

/// Payload for [`ai_set_config`]. `api_key` is only written when present and
/// non-empty, so the saved key survives a base-URL/protocol edit.
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

#[tauri::command]
pub async fn ai_get_config(state: State<'_, AppState>) -> AppResult<AiConfig> {
    let has_api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .is_some_and(|v| !v.is_empty());
    let protocol = stored_protocol(&state).await?;
    let base_url = stored_base_url(&state, protocol).await?;
    let model = settings_repo::get(&state.db, MODEL_SETTING)
        .await?
        .unwrap_or_default();
    Ok(AiConfig {
        has_api_key,
        base_url,
        protocol,
        model,
    })
}

/// Persist the endpoint configuration. Switching protocols clears the selected
/// model, since model ids are not portable across providers.
#[tauri::command]
pub async fn ai_set_config(state: State<'_, AppState>, input: AiConfigInput) -> AppResult<()> {
    if stored_protocol(&state).await? != input.protocol {
        settings_repo::set(&state.db, MODEL_SETTING, "").await?;
    }
    settings_repo::set(&state.db, BASE_URL_SETTING, input.base_url.trim()).await?;
    settings_repo::set(&state.db, PROTOCOL_SETTING, input.protocol.as_str()).await?;
    if let Some(key) = input.api_key.filter(|k| !k.is_empty()) {
        settings_repo::set(&state.db, API_KEY_SETTING, &key).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_set_model(state: State<'_, AppState>, model: String) -> AppResult<()> {
    settings_repo::set(&state.db, MODEL_SETTING, &model).await
}

/// Resolve the configured endpoint, erroring if no API key is set.
async fn endpoint(state: &AppState) -> AppResult<(String, String, Protocol)> {
    let api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .filter(|k| !k.is_empty())
        .ok_or_else(|| AppError::Invalid("no API key configured".into()))?;
    let protocol = stored_protocol(state).await?;
    let base_url = stored_base_url(state, protocol).await?;
    Ok((base_url, api_key, protocol))
}

/// Fetch the provider's available models for the chat-window picker.
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

/// Ask the assistant for its next turn. `model` is chosen in the chat window;
/// `messages` is the canonical conversation so far (never including a
/// `system` entry — the backend always supplies its own); `tools` describes
/// whatever the frontend can execute on the model's behalf. The frontend
/// drives the agent loop: it runs any returned `toolCalls`, appends the
/// results as `tool` messages, and calls this again until a final reply with
/// no tool calls comes back.
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    model: String,
    messages: Vec<ai::ChatMessage>,
    tools: Vec<ai::ToolSpec>,
) -> AppResult<ai::ChatResult> {
    if model.trim().is_empty() {
        return Err(AppError::Invalid("no model selected".into()));
    }
    let (base_url, api_key, protocol) = endpoint(&state).await?;
    ai::chat(
        &Endpoint {
            base_url: &base_url,
            api_key: &api_key,
            protocol,
        },
        &model,
        &messages,
        &tools,
    )
    .await
}

// --- Persisted chat sessions (history + multi-session support) ---
//
// A session is one saved conversation with the assistant, mirroring VS Code
// Copilot's chat history: the user can start a new one at any time, switch
// between past ones, rename or delete them. The frontend owns the running
// agent loop (see `useAgent`/the ai store) and calls `ai_session_save` after
// each turn; this layer only persists/retrieves the canonical message list —
// it never talks to the model itself.

/// One saved conversation, full detail (used when opening a session).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    pub id: String,
    pub title: String,
    pub messages: Vec<ai::ChatMessage>,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight view for the session list / history menu (no message bodies).
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

/// Newest-first list of saved sessions, for the history menu.
#[tauri::command]
pub async fn ai_session_list(state: State<'_, AppState>) -> AppResult<Vec<AiSessionSummary>> {
    let rows = ai_session_repo::list(&state.db).await?;
    Ok(rows.into_iter().map(AiSessionSummary::from).collect())
}

/// Start a brand new, empty session and make it available immediately.
#[tauri::command]
pub async fn ai_session_create(state: State<'_, AppState>) -> AppResult<AiSession> {
    let row = ai_session_repo::create(&state.db).await?;
    AiSession::from_row(row)
}

/// Load one session's full conversation, e.g. when the user switches to it.
#[tauri::command]
pub async fn ai_session_get(state: State<'_, AppState>, id: String) -> AppResult<AiSession> {
    let row = ai_session_repo::get(&state.db, &id).await?;
    AiSession::from_row(row)
}

/// Persist the running conversation after an agent turn. `title` is only
/// passed once, the first time a session gets a user message (auto-derived
/// from it client-side) — later saves omit it so a later rename sticks.
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
