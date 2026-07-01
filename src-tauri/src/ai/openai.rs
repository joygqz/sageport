//! OpenAI-compatible chat-completions wire format, including function
//! (tool) calling.

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

use super::{ChatMessage, ChatResult, Role, ToolCall, ToolSpec};

/// Build a `POST /chat/completions` request body.
pub(super) fn request_body(model: &str, messages: &[ChatMessage], tools: &[ToolSpec]) -> Value {
    let messages: Vec<Value> = messages.iter().map(message_to_json).collect();

    let mut body = json!({
        "model": model,
        "max_tokens": super::MAX_TOKENS,
        "messages": messages,
    });
    if !tools.is_empty() {
        let defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                })
            })
            .collect();
        body["tools"] = json!(defs);
        body["tool_choice"] = json!("auto");
    }
    body
}

fn message_to_json(m: &ChatMessage) -> Value {
    let role = match m.role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool",
    };
    let mut obj = Map::new();
    obj.insert("role".into(), json!(role));
    obj.insert(
        "content".into(),
        json!(m.content.clone().unwrap_or_default()),
    );
    if !m.tool_calls.is_empty() {
        let calls: Vec<Value> = m
            .tool_calls
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "type": "function",
                    "function": {
                        "name": c.name,
                        "arguments": c.arguments.to_string(),
                    },
                })
            })
            .collect();
        obj.insert("tool_calls".into(), json!(calls));
    }
    if let Some(id) = &m.tool_call_id {
        obj.insert("tool_call_id".into(), json!(id));
    }
    Value::Object(obj)
}

/// Extract the assistant's next turn (text and/or tool calls) from a
/// chat-completions response.
pub(super) fn parse_chat(bytes: &[u8]) -> AppResult<ChatResult> {
    let parsed: ChatResponse = serde_json::from_slice(bytes)?;
    let message = parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message)
        .ok_or_else(|| AppError::Other("the assistant returned no choices".into()))?;

    let content = message
        .content
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty());
    let tool_calls: Vec<ToolCall> = message
        .tool_calls
        .into_iter()
        .map(|c| {
            let arguments =
                serde_json::from_str(&c.function.arguments).unwrap_or_else(|_| json!({}));
            ToolCall {
                id: c.id,
                name: c.function.name,
                arguments,
            }
        })
        .collect();

    if content.is_none() && tool_calls.is_empty() {
        return Err(AppError::Other("the assistant returned no content".into()));
    }
    Ok(ChatResult {
        content,
        tool_calls,
    })
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<RawToolCall>,
}

#[derive(Deserialize)]
struct RawToolCall {
    id: String,
    function: RawFunctionCall,
}

#[derive(Deserialize)]
struct RawFunctionCall {
    name: String,
    arguments: String,
}
