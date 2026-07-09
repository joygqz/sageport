mod anthropic;
mod openai;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

const SYSTEM_PROMPT: &str = "You are an autonomous operations agent embedded in an SSH terminal \
client, in the same spirit as an AI coding agent: you can inspect state and act, not just talk. \
The user manages one or more remote servers, each connected in its own terminal session (tab). \
The user may be a complete beginner at server administration — never assume they know how to \
connect, which server is which, or what a command does.\n\n\
You have tools to do the work yourself:\n\
- `list_hosts` — the user's saved servers (id, label, address, group, notes). Use it to figure \
out which server the user means.\n\
- `connect_host` — open a terminal session to a saved host and wait for it to connect. When the \
user asks about a server that has no open session, connect to it yourself instead of asking the \
user to connect first.\n\
- `list_terminal_sessions` — see which sessions are open and their ids/status.\n\
- `read_terminal_output` — read what's currently on screen in a session, on demand. Prefer this \
over asking the user to paste output; call it whenever you need to see current state, and call it \
again after a command to check the result.\n\
- `run_terminal_command` — actually type a command into a session and press Enter. This runs on a \
live remote server, so the user is always shown a confirmation before it executes; you cannot \
bypass that. Use it to gather diagnostic information or perform the change the user asked for.\n\
- `ask_user` — when you need the user to choose between a few concrete options (which server, \
which of several fixes), call this instead of asking in plain text: the options are shown as \
buttons the user can click. Write the options in the user's language.\n\n\
Use tools proactively and iteratively — find the right host, connect if needed, read before \
acting, act, then read again to verify — instead of guessing or handing the work back to the \
user. Start with safe read-only diagnostic commands before making changes. When you give a \
command you are NOT running yourself, still put it in a fenced code block so the user can run or \
copy it. Prefer safe, portable, widely-available commands. Before anything destructive or risky \
(deleting data, restarting services, changing config, rebooting), say in one plain-language \
sentence what it will do and what could go wrong. When a step's result matters, explain it \
briefly in plain language a beginner can follow. Do not invent server-specific details you \
weren't given or shown by a tool. Keep replies concise. Always reply in the user's own language.";

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

    pub fn default_base_url(self) -> &'static str {
        match self {
            Protocol::Openai => "https://api.openai.com/v1",
            Protocol::Anthropic => "https://api.anthropic.com",
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
            Protocol::Openai => req.bearer_auth(self.api_key),
            Protocol::Anthropic => req
                .header("x-api-key", self.api_key)
                .header("anthropic-version", ANTHROPIC_VERSION),
        }
    }
}

pub async fn list_models(ep: &Endpoint<'_>) -> AppResult<Vec<String>> {
    let path = match ep.protocol {
        Protocol::Openai => "/models",
        Protocol::Anthropic => "/v1/models",
    };
    let req = ep.authorize(reqwest::Client::new().get(ep.url(path)));
    let bytes = send(req).await?;
    let parsed: ModelsResponse = serde_json::from_slice(&bytes)?;
    let mut models: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    models.sort();
    Ok(models)
}

pub async fn chat(
    ep: &Endpoint<'_>,
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
    context: Option<&str>,
    mut on_text: impl FnMut(&str),
) -> AppResult<ChatResult> {
    let context = context.filter(|c| !c.trim().is_empty());

    let (path, mut body) = match ep.protocol {
        Protocol::Openai => (
            "/chat/completions",
            openai::request_body(model, SYSTEM_PROMPT, context, messages, tools),
        ),
        Protocol::Anthropic => (
            "/v1/messages",
            anthropic::request_body(model, SYSTEM_PROMPT, context, messages, tools),
        ),
    };
    body["stream"] = serde_json::json!(true);

    let req = ep.authorize(reqwest::Client::new().post(ep.url(path)).json(&body));
    let mut response = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request failed: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Other(format!("failed to read response: {e}")))?;
        let message = serde_json::from_slice::<ApiError>(&bytes)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| format!("AI request failed with status {status}"));
        return Err(AppError::Other(message));
    }

    let mut openai_acc = openai::StreamAccumulator::default();
    let mut anthropic_acc = anthropic::StreamAccumulator::default();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::Other(format!("stream interrupted: {e}")))?
    {
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
            match ep.protocol {
                Protocol::Openai => openai_acc.feed(data, &mut on_text),
                Protocol::Anthropic => anthropic_acc.feed(data, &mut on_text)?,
            }
        }
    }

    match ep.protocol {
        Protocol::Openai => openai_acc.finish(),
        Protocol::Anthropic => anthropic_acc.finish(),
    }
}

async fn send(req: reqwest::RequestBuilder) -> AppResult<Vec<u8>> {
    let response = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request failed: {e}")))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("failed to read response: {e}")))?;

    if !status.is_success() {
        let message = serde_json::from_slice::<ApiError>(&bytes)
            .map(|e| e.error.message)
            .unwrap_or_else(|_| format!("AI request failed with status {status}"));
        return Err(AppError::Other(message));
    }
    Ok(bytes.to_vec())
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

#[derive(Deserialize)]
struct ApiError {
    error: ApiErrorBody,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    message: String,
}
