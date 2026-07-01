//! Vendor-neutral, tool-calling AI agent for the terminal client.
//!
//! The assistant is not tied to any single provider: it speaks either the
//! OpenAI-compatible (`/chat/completions`, `Bearer` auth) or the
//! Anthropic-compatible (`/v1/messages`, `x-api-key` auth) wire format. A
//! provider is described entirely by a base URL, an API key, and a [`Protocol`]
//! selector, so any service implementing one of those two formats works.
//!
//! Both protocols expose a models-list endpoint (`/models`), which the UI calls
//! to populate the chat-window model picker. Requests are non-streaming.
//!
//! This module only speaks a *canonical*, provider-agnostic conversation
//! format ([`ChatMessage`], [`ToolSpec`], [`ChatResult`]) and translates it to
//! and from each wire format. It never executes tools itself — the frontend
//! owns tool execution (terminal sessions live in the renderer's xterm
//! buffers) and drives the agent loop: call [`chat`], run whatever tools come
//! back in [`ChatResult::tool_calls`], append the results as `tool` messages,
//! and call [`chat`] again until a final text reply comes back.

mod anthropic;
mod openai;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

const SYSTEM_PROMPT: &str = "You are an autonomous operations agent embedded in an SSH terminal \
client, in the same spirit as an AI coding agent: you can inspect state and act, not just talk. \
The user manages one or more remote servers, each connected in its own terminal session (tab).\n\n\
You have tools to interact with those sessions:\n\
- `list_terminal_sessions` — see which sessions are open and their ids/status.\n\
- `read_terminal_output` — read what's currently on screen in a session, on demand. Prefer this \
over asking the user to paste output; call it whenever you need to see current state, and call it \
again after a command to check the result.\n\
- `run_terminal_command` — actually type a command into a session and press Enter. This runs on a \
live remote server, so the user is always shown a confirmation before it executes; you cannot \
bypass that. Use it to gather diagnostic information or perform the change the user asked for.\n\n\
Use tools proactively and iteratively — read before acting, act, then read again to verify — \
instead of guessing. When you give a command you are NOT running yourself, still put it in a \
fenced code block so the user can run or copy it. Prefer safe, portable, widely-available \
commands, and call out anything destructive or risky before doing it. Do not invent \
server-specific details you weren't given or shown by a tool. Keep replies concise.";

/// One role in a canonical conversation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

/// A single tool invocation requested by the model.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// One turn of a canonical, provider-agnostic conversation. The frontend
/// builds and stores a `Vec<ChatMessage>` (never including a `system` entry —
/// [`chat`] always prepends [`SYSTEM_PROMPT`] itself) and grows it with the
/// model's own turns and the results of whatever tools it called.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: Role,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Present on an `assistant` message that requested tool calls.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// Present on a `tool` message: which call this is the result of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// Describes one callable tool, in JSON-Schema terms, so the model knows it
/// exists and how to call it. The frontend owns the actual implementations.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// One model turn: either (or both) a text reply and a batch of tool calls to
/// run before asking the model to continue.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
}

/// Wire format spoken by the configured endpoint.
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

    /// Conventional base URL when the user hasn't entered one.
    pub fn default_base_url(self) -> &'static str {
        match self {
            Protocol::Openai => "https://api.openai.com/v1",
            Protocol::Anthropic => "https://api.anthropic.com",
        }
    }
}

/// Resolved connection details for a single request.
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

/// Fetch the provider's available model ids, sorted alphabetically.
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

/// Send a canonical conversation (plus the tools the model may call) and
/// return its next turn. [`SYSTEM_PROMPT`] is always prepended, so `messages`
/// should only ever contain `user`/`assistant`/`tool` entries.
pub async fn chat(
    ep: &Endpoint<'_>,
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
) -> AppResult<ChatResult> {
    let mut full = Vec::with_capacity(messages.len() + 1);
    full.push(ChatMessage {
        role: Role::System,
        content: Some(SYSTEM_PROMPT.to_string()),
        tool_calls: Vec::new(),
        tool_call_id: None,
    });
    full.extend_from_slice(messages);

    let (path, body) = match ep.protocol {
        Protocol::Openai => (
            "/chat/completions",
            openai::request_body(model, &full, tools),
        ),
        Protocol::Anthropic => ("/v1/messages", anthropic::request_body(model, &full, tools)),
    };

    let req = ep.authorize(reqwest::Client::new().post(ep.url(path)).json(&body));
    let bytes = send(req).await?;

    match ep.protocol {
        Protocol::Openai => openai::parse_chat(&bytes),
        Protocol::Anthropic => anthropic::parse_chat(&bytes),
    }
}

/// Drive a request to completion and surface provider error bodies. Both wire
/// formats report failures as `{ "error": { "message": ... } }`.
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
