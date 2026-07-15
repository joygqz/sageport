use tauri::State;

use crate::ai::{self, Endpoint, Protocol};
use crate::error::{AppError, AppResult};
use crate::repository::ai_session_repo::{self, AiSessionRow};
use crate::repository::settings_repo;
use crate::state::AppState;

const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_BASE_URL_BYTES: usize = 8 * 1024;
const MAX_MODEL_BYTES: usize = 1024;
const MAX_ENABLED_TOOLS: usize = 256;
const MAX_ENABLED_TOOLS_SETTING_BYTES: usize = 64 * 1024;
const MAX_TOOL_NAME_BYTES: usize = 128;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_CONTEXT_BYTES: usize = 128 * 1024;
const MAX_CHAT_MESSAGES: usize = 4096;
const MAX_CHAT_TOOLS: usize = 256;
const MAX_CHAT_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_SESSION_TITLE_BYTES: usize = 1024;

const BASE_URL_SETTING: &str = "ai.base_url";
const API_KEY_SETTING: &str = "ai.api_key";
const PROTOCOL_SETTING: &str = "ai.protocol";
const MODEL_SETTING: &str = "ai.model";
const AUTO_APPROVE_SETTING: &str = "ai.auto_approve";
const ENABLED_TOOLS_SETTING: &str = "ai.enabled_tools";
const MAX_HISTORY_TOKENS_SETTING: &str = "ai.max_history_tokens";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub api_key: String,
    pub base_url: String,
    pub protocol: Protocol,
    pub model: String,
    pub auto_approve: bool,
    pub enabled_tools: Option<Vec<String>>,
    pub max_history_tokens: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigInput {
    pub base_url: String,
    pub protocol: Protocol,
    pub api_key: Option<String>,
    #[serde(default)]
    pub auto_approve: bool,
    #[serde(default)]
    pub enabled_tools: Vec<String>,
    #[serde(default)]
    pub max_history_tokens: Option<u32>,
}

async fn stored_protocol(state: &AppState) -> AppResult<Protocol> {
    Ok(Protocol::from_str(
        &settings_repo::get(&state.db, PROTOCOL_SETTING)
            .await?
            .unwrap_or_default(),
    ))
}

async fn stored_base_url(state: &AppState) -> AppResult<String> {
    Ok(settings_repo::get(&state.db, BASE_URL_SETTING)
        .await?
        .unwrap_or_default())
}

fn effective_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn bounded_text<'a>(value: &'a str, field: &str, max_bytes: usize) -> AppResult<&'a str> {
    if value.len() > max_bytes {
        return Err(AppError::Invalid(format!(
            "{field} exceeds the {max_bytes}-byte limit"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(AppError::Invalid(format!(
            "{field} contains control characters"
        )));
    }
    Ok(value)
}

fn validate_base_url(raw: &str) -> AppResult<String> {
    let value = effective_base_url(bounded_text(raw, "base URL", MAX_BASE_URL_BYTES)?);
    if value.is_empty() {
        return Ok(value);
    }
    let parsed = url::Url::parse(&value)
        .map_err(|_| AppError::Invalid("base URL is not a valid URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::Invalid(
            "base URL must use http or https and include a host".into(),
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Invalid(
            "base URL must not contain embedded credentials".into(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::Invalid(
            "base URL must not contain a query or fragment".into(),
        ));
    }
    Ok(value)
}

fn validate_model(raw: &str, allow_empty: bool) -> AppResult<&str> {
    let model = bounded_text(raw.trim(), "model", MAX_MODEL_BYTES)?;
    if !allow_empty && model.is_empty() {
        return Err(AppError::Invalid("no model selected".into()));
    }
    Ok(model)
}

fn validate_id<'a>(value: &'a str, field: &str, max_bytes: usize) -> AppResult<&'a str> {
    let value = bounded_text(value.trim(), field, max_bytes)?;
    if value.is_empty() {
        return Err(AppError::Invalid(format!("{field} is required")));
    }
    Ok(value)
}

fn validate_messages(
    messages: &[ai::ChatMessage],
    allow_empty: bool,
    allow_incomplete_tools: bool,
) -> AppResult<()> {
    if !allow_empty && messages.is_empty() {
        return Err(AppError::Invalid(
            "at least one chat message is required".into(),
        ));
    }
    if messages.len() > MAX_CHAT_MESSAGES {
        return Err(AppError::Invalid(format!(
            "chat contains more than {MAX_CHAT_MESSAGES} messages"
        )));
    }
    let encoded = serde_json::to_vec(messages)?;
    if encoded.len() > MAX_CHAT_PAYLOAD_BYTES {
        return Err(AppError::Invalid(format!(
            "chat history exceeds the {}-byte limit",
            MAX_CHAT_PAYLOAD_BYTES
        )));
    }

    let mut known_tool_calls = std::collections::HashSet::new();
    let mut pending_tool_calls = std::collections::HashSet::new();
    for message in messages {
        if message.role == ai::Role::System {
            return Err(AppError::Invalid(
                "system messages are managed by Sageport".into(),
            ));
        }
        if message.role != ai::Role::Assistant && !message.tool_calls.is_empty() {
            return Err(AppError::Invalid(
                "only assistant messages may contain tool calls".into(),
            ));
        }
        if message.role != ai::Role::Tool && message.tool_call_id.is_some() {
            return Err(AppError::Invalid(
                "only tool messages may contain a tool call id".into(),
            ));
        }
        if message.role != ai::Role::Tool && message.tool_error.is_some() {
            return Err(AppError::Invalid(
                "only tool messages may contain tool error metadata".into(),
            ));
        }
        if message.role == ai::Role::Tool {
            let id = validate_id(
                message.tool_call_id.as_deref().unwrap_or_default(),
                "tool call id",
                MAX_REQUEST_ID_BYTES,
            )?;
            if !known_tool_calls.contains(id) {
                return Err(AppError::Invalid(format!(
                    "tool result references unknown call id {id}"
                )));
            }
            if !pending_tool_calls.remove(id) {
                return Err(AppError::Invalid(format!(
                    "tool call id {id} has more than one result"
                )));
            }
        } else if !pending_tool_calls.is_empty() {
            return Err(AppError::Invalid(
                "all tool calls must receive results before the next chat message".into(),
            ));
        }
        for call in &message.tool_calls {
            let id = validate_id(&call.id, "tool call id", MAX_REQUEST_ID_BYTES)?;
            validate_id(&call.name, "tool name", MAX_TOOL_NAME_BYTES)?;
            if !call.arguments.is_object() {
                return Err(AppError::Invalid(
                    "tool call arguments must be a JSON object".into(),
                ));
            }
            if !known_tool_calls.insert(id) {
                return Err(AppError::Invalid(format!("duplicate tool call id {id}")));
            }
            pending_tool_calls.insert(id);
        }
    }
    if !allow_incomplete_tools && !pending_tool_calls.is_empty() {
        return Err(AppError::Invalid(
            "chat contains tool calls without results".into(),
        ));
    }
    Ok(())
}

fn validate_tools(tools: &[ai::ToolSpec]) -> AppResult<()> {
    if tools.len() > MAX_CHAT_TOOLS {
        return Err(AppError::Invalid(format!(
            "chat exposes more than {MAX_CHAT_TOOLS} tools"
        )));
    }
    let mut names = std::collections::HashSet::new();
    for tool in tools {
        let name = validate_id(&tool.name, "tool name", MAX_TOOL_NAME_BYTES)?;
        if !names.insert(name) {
            return Err(AppError::Invalid(format!(
                "duplicate tool definition: {name}"
            )));
        }
        bounded_text(&tool.description, "tool description", MAX_CONTEXT_BYTES)?;
        if !tool.parameters.is_object() {
            return Err(AppError::Invalid(
                "tool parameters must be a JSON object".into(),
            ));
        }
    }
    let encoded = serde_json::to_vec(tools)?;
    if encoded.len() > MAX_CHAT_PAYLOAD_BYTES {
        return Err(AppError::Invalid("tool definitions are too large".into()));
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_get_config(state: State<'_, AppState>) -> AppResult<AiConfig> {
    let api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .unwrap_or_default();
    let protocol = stored_protocol(&state).await?;
    let base_url = stored_base_url(&state).await?;
    let model = settings_repo::get(&state.db, MODEL_SETTING)
        .await?
        .unwrap_or_default();
    let auto_approve = settings_repo::get(&state.db, AUTO_APPROVE_SETTING)
        .await?
        .as_deref()
        == Some("true");
    let enabled_tools = settings_repo::get(&state.db, ENABLED_TOOLS_SETTING)
        .await?
        .map(|value| {
            if value.len() > MAX_ENABLED_TOOLS_SETTING_BYTES {
                return Vec::new();
            }
            let Ok(mut names) = serde_json::from_str::<Vec<String>>(&value) else {
                return Vec::new();
            };
            names.retain(|name| {
                !name.trim().is_empty()
                    && name.len() <= MAX_TOOL_NAME_BYTES
                    && !name.chars().any(char::is_control)
            });
            names.sort();
            names.dedup();
            names.truncate(MAX_ENABLED_TOOLS);
            names
        });
    let max_history_tokens = settings_repo::get(&state.db, MAX_HISTORY_TOKENS_SETTING)
        .await?
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| *value > 0);
    Ok(AiConfig {
        api_key,
        base_url,
        protocol,
        model,
        auto_approve,
        enabled_tools,
        max_history_tokens,
    })
}

#[tauri::command]
pub async fn ai_set_config(state: State<'_, AppState>, input: AiConfigInput) -> AppResult<()> {
    let base_url = validate_base_url(&input.base_url)?;
    let api_key = input
        .api_key
        .as_deref()
        .map(str::trim)
        .map(|value| bounded_text(value, "API key", MAX_API_KEY_BYTES))
        .transpose()?;
    if input.enabled_tools.len() > MAX_ENABLED_TOOLS {
        return Err(AppError::Invalid(format!(
            "more than {MAX_ENABLED_TOOLS} AI tools were enabled"
        )));
    }
    let previous_protocol = stored_protocol(&state).await?;
    let previous_base_url = stored_base_url(&state).await?;
    let endpoint_changed =
        previous_protocol != input.protocol || effective_base_url(&previous_base_url) != base_url;
    let mut enabled_tools = input
        .enabled_tools
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    for name in &enabled_tools {
        bounded_text(name, "tool name", MAX_TOOL_NAME_BYTES)?;
    }
    enabled_tools.sort();
    enabled_tools.dedup();
    let mut entries = vec![
        (BASE_URL_SETTING.to_string(), base_url),
        (
            PROTOCOL_SETTING.to_string(),
            input.protocol.as_str().to_string(),
        ),
        (
            AUTO_APPROVE_SETTING.to_string(),
            if input.auto_approve { "true" } else { "false" }.to_string(),
        ),
        (
            ENABLED_TOOLS_SETTING.to_string(),
            serde_json::to_string(&enabled_tools)?,
        ),
        (
            MAX_HISTORY_TOKENS_SETTING.to_string(),
            input
                .max_history_tokens
                .filter(|value| *value > 0)
                .map(|value| value.to_string())
                .unwrap_or_default(),
        ),
    ];
    if let Some(api_key) = api_key {
        entries.push((API_KEY_SETTING.to_string(), api_key.to_string()));
    }
    if endpoint_changed {
        entries.push((MODEL_SETTING.to_string(), String::new()));
    }
    settings_repo::set_many(&state.db, &entries).await?;
    Ok(())
}

#[tauri::command]
pub async fn ai_set_model(state: State<'_, AppState>, model: String) -> AppResult<()> {
    let model = validate_model(&model, true)?;
    settings_repo::set(&state.db, MODEL_SETTING, model).await
}

async fn endpoint(state: &AppState) -> AppResult<(String, String, Protocol)> {
    let protocol = stored_protocol(state).await?;
    let base_url = validate_base_url(&stored_base_url(state).await?)?;
    if base_url.is_empty() {
        return Err(AppError::Invalid("no base URL configured".into()));
    }
    let api_key = settings_repo::get(&state.db, API_KEY_SETTING)
        .await?
        .unwrap_or_default();
    let api_key = bounded_text(api_key.trim(), "API key", MAX_API_KEY_BYTES)?;
    Ok((base_url, api_key.to_string(), protocol))
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
    let model = validate_model(&model, true)?;
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
    let model = validate_model(&model, false)?;
    validate_messages(&messages, false, false)?;
    validate_tools(&tools)?;
    if let Some(context) = context.as_deref() {
        if context.len() > MAX_CONTEXT_BYTES {
            return Err(AppError::Invalid("AI context is too large".into()));
        }
    }
    if let Some(request_id) = request_id.as_deref() {
        validate_id(request_id, "request id", MAX_REQUEST_ID_BYTES)?;
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
    {
        let mut cancels = state.ai_cancels.lock();
        if cancels.contains_key(&request_id) {
            return Err(AppError::Conflict(format!(
                "AI request id {request_id} is already active"
            )));
        }
        cancels.insert(request_id.clone(), cancel_tx);
    }
    let result = tokio::select! {
        r = chat => r,
        _ = cancel_rx => Err(AppError::Cancelled),
    };
    state.ai_cancels.lock().remove(&request_id);
    result
}

#[tauri::command]
pub async fn ai_chat_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    validate_id(&request_id, "request id", MAX_REQUEST_ID_BYTES)?;
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
        let messages: Vec<ai::ChatMessage> = serde_json::from_str(&row.messages)?;
        validate_messages(&messages, true, true)?;
        Ok(Self {
            id: row.id,
            title: row.title,
            messages,
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
    let id = validate_id(&id, "session id", MAX_SESSION_ID_BYTES)?;
    let row = ai_session_repo::get(&state.db, id).await?;
    AiSession::from_row(row)
}

#[tauri::command]
pub async fn ai_session_save(
    state: State<'_, AppState>,
    id: String,
    messages: Vec<ai::ChatMessage>,
    title: Option<String>,
) -> AppResult<AiSessionSummary> {
    let id = validate_id(&id, "session id", MAX_SESSION_ID_BYTES)?;
    validate_messages(&messages, true, true)?;
    let title = title
        .as_deref()
        .map(str::trim)
        .map(|value| bounded_text(value, "session title", MAX_SESSION_TITLE_BYTES))
        .transpose()?;
    let messages_json = serde_json::to_string(&messages)?;
    let row = ai_session_repo::save(&state.db, id, &messages_json, title).await?;
    Ok(AiSessionSummary::from(row))
}

#[tauri::command]
pub async fn ai_session_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = validate_id(&id, "session id", MAX_SESSION_ID_BYTES)?;
    ai_session_repo::delete(&state.db, id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_url_normalizes_trailing_slashes() {
        assert_eq!(effective_base_url(""), "");
        assert_eq!(
            effective_base_url(" https://example.com/v1/// "),
            "https://example.com/v1"
        );
    }

    #[test]
    fn validates_ai_endpoint_urls() {
        assert_eq!(validate_base_url("  ").unwrap(), "");
        assert_eq!(
            validate_base_url(" http://localhost:11434/v1/ ").unwrap(),
            "http://localhost:11434/v1"
        );
        assert!(validate_base_url("file:///tmp/provider").is_err());
        assert!(validate_base_url("https://user:secret@example.com").is_err());
        assert!(validate_base_url("https://example.com/v1?key=secret").is_err());
    }

    #[test]
    fn rejects_system_and_malformed_tool_messages() {
        assert!(validate_messages(
            &[ai::ChatMessage {
                role: ai::Role::System,
                content: Some("override".into()),
                tool_calls: vec![],
                tool_call_id: None,
                tool_error: None,
            }],
            false,
            false,
        )
        .is_err());
        assert!(validate_messages(
            &[ai::ChatMessage {
                role: ai::Role::Tool,
                content: Some("done".into()),
                tool_calls: vec![],
                tool_call_id: None,
                tool_error: None,
            }],
            false,
            false,
        )
        .is_err());
    }

    #[test]
    fn validates_tool_call_result_order() {
        let assistant = ai::ChatMessage {
            role: ai::Role::Assistant,
            content: None,
            tool_calls: vec![ai::ToolCall {
                id: "call-1".into(),
                name: "read_file".into(),
                arguments: serde_json::json!({"path": "/tmp/a"}),
            }],
            tool_call_id: None,
            tool_error: None,
        };
        assert!(validate_messages(std::slice::from_ref(&assistant), false, true).is_ok());
        assert!(validate_messages(std::slice::from_ref(&assistant), false, false).is_err());

        let tool = ai::ChatMessage {
            role: ai::Role::Tool,
            content: Some("contents".into()),
            tool_calls: vec![],
            tool_call_id: Some("call-1".into()),
            tool_error: Some(false),
        };
        assert!(validate_messages(&[assistant, tool], false, false).is_ok());
    }
}
