mod anthropic;
mod openai;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;

use crate::error::{AppError, AppResult};

const ANTHROPIC_VERSION: &str = "2023-06-01";
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 16_000;
pub const MAX_OUTPUT_TOKENS: u32 = 64_000;
const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 2 * 1024 * 1024;
const MAX_LISTED_MODELS: usize = 5_000;
const MAX_MODEL_ID_BYTES: usize = 1_024;
const MAX_ERROR_MESSAGE_CHARS: usize = 4_096;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const METADATA_TIMEOUT: Duration = Duration::from_secs(30);

const SYSTEM_PROMPT: &str = "You are an autonomous operations agent inside Sageport, an SSH \
client. Inspect and act with the provided tools instead of guessing or handing work back to the \
user.\n\n\
If app context provides a Current terminal, use it for any request that does not explicitly name \
another or multiple hosts. Never list or ask the user to select a server just to confirm that \
default. With no Current terminal, ask only when the target is genuinely ambiguous. Explicit user \
scope always wins.\n\n\
Work iteratively: inspect, start with safe read-only diagnostics, act, then verify. Connect hosts \
and read terminal output yourself rather than asking the user to do it. The app context states \
whether operation tools require approval. Before destructive or risky actions, briefly explain \
the effect and risk. Never invent details not supplied by the user or tools. Keep replies concise, \
beginner-friendly, and in the user's language. Put commands you are only suggesting in fenced code \
blocks. For large files or logs, count lines and read consecutive small ranges until the requested \
scope is covered; never claim to have reviewed omitted or truncated content.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: Role,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_error: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Text { text: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Openai,
    Anthropic,
}

impl Protocol {
    pub fn from_str(raw: &str) -> Self {
        match raw {
            "anthropic" => Protocol::Anthropic,
            _ => Protocol::Openai,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Protocol::Openai => "openai",
            Protocol::Anthropic => "anthropic",
        }
    }

}

pub struct Endpoint<'a> {
    pub base_url: &'a str,
    pub api_key: &'a str,
    pub protocol: Protocol,
}

impl Endpoint<'_> {
    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), path)
    }

    fn authorize(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match self.protocol {
            Protocol::Openai => {
                if self.api_key.is_empty() {
                    req
                } else {
                    req.bearer_auth(self.api_key)
                }
            }
            Protocol::Anthropic => {
                let req = req.header("anthropic-version", ANTHROPIC_VERSION);
                if self.api_key.is_empty() {
                    req
                } else {
                    req.header("x-api-key", self.api_key)
                }
            }
        }
    }
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("valid AI HTTP client configuration")
    })
}

pub async fn list_models(ep: &Endpoint<'_>) -> AppResult<Vec<String>> {
    let path = match ep.protocol {
        Protocol::Openai => "/models",
        Protocol::Anthropic => "/v1/models",
    };
    let req = ep
        .authorize(http_client().get(ep.url(path)))
        .timeout(METADATA_TIMEOUT);
    let bytes = send(req).await?;
    let parsed: ModelsResponse = serde_json::from_slice(&bytes)?;
    let mut models: Vec<String> = parsed
        .data
        .into_iter()
        .map(|model| model.id.trim().to_string())
        .filter(|id| {
            !id.is_empty() && id.len() <= MAX_MODEL_ID_BYTES && !id.chars().any(char::is_control)
        })
        .collect();
    models.sort();
    models.dedup();
    models.truncate(MAX_LISTED_MODELS);
    Ok(models)
}

pub async fn model_limits(ep: &Endpoint<'_>, model: &str) -> ModelLimits {
    let collection_path = match ep.protocol {
        Protocol::Openai => "/models",
        Protocol::Anthropic => "/v1/models",
    };
    let Ok(mut url) = reqwest::Url::parse(&ep.url(collection_path)) else {
        return ModelLimits::default();
    };
    let Ok(mut segments) = url.path_segments_mut() else {
        return ModelLimits::default();
    };
    segments.push(model);
    drop(segments);
    let req = ep
        .authorize(http_client().get(url))
        .timeout(METADATA_TIMEOUT);
    let Ok(bytes) = send(req).await else {
        return ModelLimits::default();
    };
    let Ok(info) = serde_json::from_slice::<ModelInfo>(&bytes) else {
        return ModelLimits::default();
    };
    let provider = info.top_provider.unwrap_or_default();
    ModelLimits {
        context_window: info
            .max_input_tokens
            .or(info.context_length)
            .or(info.max_context_length)
            .or(info.context_window)
            .or(provider.context_length),
        max_output_tokens: info
            .max_output_tokens
            .or(info.max_completion_tokens)
            .or(provider.max_completion_tokens)
            .or(info.max_tokens),
    }
}

pub async fn chat(
    ep: &Endpoint<'_>,
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
    context: Option<&str>,
    max_tokens: u32,
    mut on_text: impl FnMut(&str),
) -> AppResult<ChatResult> {
    let context = context.filter(|c| !c.trim().is_empty());

    let (path, mut body) = match ep.protocol {
        Protocol::Openai => (
            "/chat/completions",
            openai::request_body(model, SYSTEM_PROMPT, context, messages, tools, max_tokens),
        ),
        Protocol::Anthropic => (
            "/v1/messages",
            anthropic::request_body(model, SYSTEM_PROMPT, context, messages, tools, max_tokens),
        ),
    };
    body["stream"] = serde_json::json!(true);

    let req = ep.authorize(http_client().post(ep.url(path)).json(&body));
    let mut response = req
        .send()
        .await
        .map_err(|e| request_error("request failed", e))?;

    let status = response.status();
    if !status.is_success() {
        let bytes = read_response(response, MAX_METADATA_BYTES).await?;
        return Err(status_error(status, &bytes));
    }

    let mut openai_acc = openai::StreamAccumulator::default();
    let mut anthropic_acc = anthropic::StreamAccumulator::default();
    let mut buf: Vec<u8> = Vec::new();
    let mut received_bytes = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| request_error("stream interrupted", e))?
    {
        received_bytes = received_bytes.saturating_add(chunk.len());
        if received_bytes > MAX_STREAM_BYTES {
            return Err(AppError::Other(
                "the assistant response was too large".into(),
            ));
        }
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            feed_stream_data(
                ep.protocol,
                data,
                &mut openai_acc,
                &mut anthropic_acc,
                &mut on_text,
            )?;
        }
    }
    if !buf.is_empty() {
        let line = String::from_utf8_lossy(&buf);
        if let Some(data) = line.trim().strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() && data != "[DONE]" {
                feed_stream_data(
                    ep.protocol,
                    data,
                    &mut openai_acc,
                    &mut anthropic_acc,
                    &mut on_text,
                )?;
            }
        }
    }

    match ep.protocol {
        Protocol::Openai => openai_acc.finish(),
        Protocol::Anthropic => anthropic_acc.finish(),
    }
}

fn feed_stream_data(
    protocol: Protocol,
    data: &str,
    openai_acc: &mut openai::StreamAccumulator,
    anthropic_acc: &mut anthropic::StreamAccumulator,
    on_text: &mut dyn FnMut(&str),
) -> AppResult<()> {
    match protocol {
        Protocol::Openai => openai_acc.feed(data, on_text)?,
        Protocol::Anthropic => anthropic_acc.feed(data, on_text)?,
    }
    Ok(())
}

async fn send(req: reqwest::RequestBuilder) -> AppResult<Vec<u8>> {
    let response = req
        .send()
        .await
        .map_err(|e| request_error("request failed", e))?;
    let status = response.status();
    let bytes = read_response(response, MAX_METADATA_BYTES).await?;

    if !status.is_success() {
        return Err(status_error(status, &bytes));
    }
    Ok(bytes)
}

fn request_error(context: &str, error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Timeout(format!("{context}: timed out"))
    } else {
        AppError::Network(format!("{context}: {error}"))
    }
}

async fn read_response(mut response: reqwest::Response, limit: usize) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(AppError::Other("AI provider response was too large".into()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| request_error("failed to read response", e))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::Other("AI provider response was too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn status_error(status: reqwest::StatusCode, bytes: &[u8]) -> AppError {
    let parsed = serde_json::from_slice::<ApiError>(bytes).ok();
    let message = parsed
        .as_ref()
        .map(|e| e.error.message.clone())
        .unwrap_or_else(|| format!("AI request failed with status {status}"));
    let message: String = message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
        AppError::Network(message)
    } else if is_context_length_error(status, parsed.as_ref(), &message) {
        AppError::ContextLength(message)
    } else {
        AppError::Other(message)
    }
}

fn is_context_length_error(
    status: reqwest::StatusCode,
    parsed: Option<&ApiError>,
    message: &str,
) -> bool {
    if status != reqwest::StatusCode::BAD_REQUEST
        && status != reqwest::StatusCode::PAYLOAD_TOO_LARGE
    {
        return false;
    }
    if parsed
        .and_then(|e| e.error.code.as_deref())
        .is_some_and(|code| code == "context_length_exceeded")
    {
        return true;
    }
    let lower = message.to_ascii_lowercase();
    [
        "context length",
        "context window",
        "maximum context",
        "too many tokens",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
        || (lower.contains("prompt is too long"))
        || (lower.contains("input") && lower.contains("too long"))
        || (lower.contains("reduce") && lower.contains("length"))
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelLimits {
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Default, Deserialize)]
struct ModelInfo {
    #[serde(default)]
    max_input_tokens: Option<u32>,
    #[serde(default)]
    context_length: Option<u32>,
    #[serde(default)]
    max_context_length: Option<u32>,
    #[serde(default)]
    context_window: Option<u32>,
    #[serde(default)]
    max_tokens: Option<u32>,
    #[serde(default)]
    max_output_tokens: Option<u32>,
    #[serde(default)]
    max_completion_tokens: Option<u32>,
    #[serde(default)]
    top_provider: Option<TopProviderInfo>,
}

#[derive(Default, Deserialize)]
struct TopProviderInfo {
    #[serde(default)]
    context_length: Option<u32>,
    #[serde(default)]
    max_completion_tokens: Option<u32>,
}

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    message: String,
    #[serde(default)]
    code: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn classifies_context_length_by_code() {
        let body = br#"{"error":{"message":"whatever","code":"context_length_exceeded"}}"#;
        assert_eq!(
            status_error(StatusCode::BAD_REQUEST, body).code(),
            "context_length"
        );
    }

    #[test]
    fn classifies_context_length_by_message() {
        let body = br#"{"error":{"message":"prompt is too long: 250000 tokens > 200000 maximum context"}}"#;
        assert_eq!(
            status_error(StatusCode::BAD_REQUEST, body).code(),
            "context_length"
        );
    }

    #[test]
    fn keeps_other_bad_requests_as_other() {
        let body = br#"{"error":{"message":"invalid model"}}"#;
        assert_eq!(status_error(StatusCode::BAD_REQUEST, body).code(), "other");
    }

    #[test]
    fn server_errors_stay_network() {
        let body = br#"{"error":{"message":"context length exceeded"}}"#;
        assert_eq!(
            status_error(StatusCode::INTERNAL_SERVER_ERROR, body).code(),
            "network"
        );
    }
}
