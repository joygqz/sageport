//! Vendor-neutral, tool-calling AI agent for the terminal client.
//!
//! The assistant is not tied to any single provider: it speaks either the
//! OpenAI-compatible (`/chat/completions`, `Bearer` auth) or the
//! Anthropic-compatible (`/v1/messages`, `x-api-key` auth) wire format. A
//! provider is described entirely by a base URL, an API key, and a [`Protocol`]
//! selector, so any service implementing one of those two formats works.
//!
//! Both protocols expose a models-list endpoint (`/models`), which the UI calls
//! to populate the chat-window model picker. Chat requests stream (SSE): text
//! deltas are surfaced through a callback as they arrive, while the complete
//! turn — including any tool calls — is accumulated and returned at the end.
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
server-specific details you weren't given or shown by a tool. Keep replies concise. \
Always reply in the user's own language.";

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

/// Incremental event pushed to the frontend while a chat turn streams.
/// Only assistant text streams; tool calls are delivered whole via the
/// final [`ChatResult`] once their JSON arguments are complete.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum StreamEvent {
    Text { text: String },
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
/// stream its next turn: `on_text` fires for each assistant text delta as it
/// arrives, and the accumulated turn (text + tool calls) is returned whole.
///
/// [`SYSTEM_PROMPT`] is always prepended (with `context` — a snapshot of the
/// user's workspace: open sessions, UI language, app version — appended to
/// it), so `messages` should only ever contain `user`/`assistant`/`tool`
/// entries.
pub async fn chat(
    ep: &Endpoint<'_>,
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolSpec],
    context: Option<&str>,
    mut on_text: impl FnMut(&str),
) -> AppResult<ChatResult> {
    let mut system = SYSTEM_PROMPT.to_string();
    if let Some(ctx) = context.filter(|c| !c.trim().is_empty()) {
        system.push_str("\n\n# Current workspace context\n");
        system.push_str(ctx);
    }

    let mut full = Vec::with_capacity(messages.len() + 1);
    full.push(ChatMessage {
        role: Role::System,
        content: Some(system),
        tool_calls: Vec::new(),
        tool_call_id: None,
    });
    full.extend_from_slice(messages);

    let (path, mut body) = match ep.protocol {
        Protocol::Openai => (
            "/chat/completions",
            openai::request_body(model, &full, tools),
        ),
        Protocol::Anthropic => ("/v1/messages", anthropic::request_body(model, &full, tools)),
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

    // Both wire formats stream as server-sent events: newline-separated
    // `data: <json>` lines (Anthropic adds `event:` lines we can ignore —
    // each data payload restates its own `type`). Chunks can split a line
    // anywhere, so buffer bytes and only process complete lines.
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
